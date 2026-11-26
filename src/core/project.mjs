import { compactThemeLossless, inspectThemeImport, parseColor } from '../../shared/theme-core.mjs';
import { fieldCatalog } from '../data/index.mjs';
import { styleTheme, tuneTheme, toVariant } from './engine.mjs';

export const variants = Object.freeze(['light', 'dark']);
export const otherVariant = (v) => v === 'light' ? 'dark' : 'light';
export const fields = new Map(fieldCatalog.fields.filter(({ type, effect }) => type === 'color' && effect.kind !== 'dead')
  .map((field) => [field.path, field]));
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const originKinds = new Set(['default', 'preset', 'builtin', 'saved', 'import', 'seeds', 'image', 'random']);
const knobNames = ['hue', 'chroma', 'lightness', 'contrast', 'temperature'];
const groupNames = ['canvas', 'text', 'accent', 'interaction', 'syntax', 'status', 'details'];
const has = (object, key) => Object.hasOwn(object ?? {}, key);
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const titleOf = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 90) : '';
const clamp = (value, min, max, fallback = 0) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const byVariant = (fn) => Object.fromEntries(variants.map((v) => [v, fn(v)]));
export const onlyVariants = (value, fallback = variants) => variants.filter((v) =>
  (Array.isArray(value) ? value : variants.includes(value) ? [value] : fallback).includes(v));

export const matchingOf = (input) => {
  const result = {};
  for (const key of ['uiFont', 'monoFont', 'uiFontWeight', 'fontSize', 'padding', 'chatWidth', 'layoutAnimations']) {
    const value = input?.[key];
    if ((typeof value === 'string' && value.length <= 220) || Number.isFinite(value) || typeof value === 'boolean') result[key] = value;
  }
  return result;
};
export const styleOf = (value) => ({
  id: typeof value?.id === 'string' && /^[a-z][a-z0-9-]{0,49}$/u.test(value.id) ? value.id : null,
  strength: clamp(value?.strength, 0, 1, 1),
  options: Object.fromEntries(Object.entries(value?.options ?? {}).slice(0, 30).filter(([key, v]) =>
    /^[a-z][a-z0-9_-]{0,49}$/iu.test(key) && ((typeof v === 'string' && v.length <= 100) || Number.isFinite(v) || typeof v === 'boolean'))),
});
const knobsOf = (value) => Object.fromEntries(knobNames.map((key) =>
  [key, clamp(value?.[key], key === 'hue' ? -180 : -1, key === 'hue' ? 180 : 1)]));
export const tuneOf = (value) => ({
  global: knobsOf(value?.global ?? value),
  groups: Object.fromEntries(groupNames.filter((group) => object(value?.groups?.[group]))
    .map((group) => [group, knobsOf(value.groups[group])])),
  protectStatus: value?.protectStatus !== false,
  protectSyntax: value?.protectSyntax !== false,
});
export function safeColor(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 250 || /[;{}<>\\]/u.test(value) ||
    /\b(?:var|env|attr|url|image(?:-set)?|paint|light-dark)\s*\(|\b(?:currentcolor|inherit|initial|unset|revert(?:-layer)?)\b/iu.test(value)) return false;
  if (!/^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([\w#.,%\s/+()-]*\))$/iu.test(value.trim())) return false;
  return globalThis.CSS ? CSS.supports('color', value) : Boolean(parseColor(value));
}
const overridesOf = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([path, color]) => fields.has(path) && safeColor(color)));

export function normalizeProject(input) {
  if (!object(input) || input.schemaVersion !== 1) throw new TypeError('unsupportedProject');
  const base = byVariant((v) => {
    const { definition } = inspectThemeImport(input.base?.[v]);
    if (!definition || definition.metadata.variant !== v) throw new TypeError('invalidProjectTheme');
    return definition;
  });
  const ref = input.origin?.ref;
  return {
    schemaVersion: 1,
    id: typeof input.id === 'string' && /^[\w-]{1,128}$/u.test(input.id) ? input.id : uid(),
    name: titleOf(input.name) || 'Untitled',
    origin: { kind: originKinds.has(input.origin?.kind) ? input.origin.kind : 'import',
      ...(typeof ref === 'string' && ref.length <= 180 ? { ref } : {}) },
    base,
    linked: input.linked !== false,
    style: byVariant((v) => styleOf(input.style?.[v])),
    tune: byVariant((v) => tuneOf(input.tune?.[v])),
    overrides: byVariant((v) => overridesOf(input.overrides?.[v])),
    matching: matchingOf(input.matching),
  };
}

export const newProject = ({ base, name = 'Untitled', kind = 'import', ref, matching }) => normalizeProject({
  schemaVersion: 1, base, name, origin: { kind, ref }, matching,
});
export function patchTune(state, patch) {
  const { group, groups, global, ...other } = patch;
  const merged = { ...state.groups };
  for (const [key, value] of Object.entries(groups ?? {})) {
    if (groupNames.includes(key)) merged[key] = { ...merged[key], ...value };
  }
  if (groupNames.includes(group)) return tuneOf({ ...state, groups: { ...merged, [group]: { ...merged[group], ...other } } });
  return tuneOf({ ...state, ...other, global: { ...state.global, ...other, ...global }, groups: merged });
}
function assignPath(root, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  const branch = keys.reduce((node, key) => node[key] ??= {}, root);
  branch[leaf] = value;
}

export function withCounterpart(project, target) {
  const source = otherVariant(target);
  return {
    ...project, base: { ...project.base, [target]: toVariant(project.base[source], target).definition },
    style: { ...project.style, [target]: project.style[source] },
    tune: { ...project.tune, [target]: project.tune[source] },
  };
}
export function comparableVariant(project, variant) {
  return JSON.stringify([project.name, project.base[variant], project.style[variant], project.tune[variant],
    project.overrides[variant], project.matching]);
}
export function resolveProject(project, variant, { compact = true } = {}) {
  const adjusted = tuneTheme(styleTheme(project.base[variant], project.style[variant]), project.tune[variant]);
  const result = structuredClone(adjusted);
  for (const [path, value] of Object.entries(project.overrides[variant])) if (fields.has(path)) assignPath(result, path, value);
  return compact ? compactThemeLossless(result) : result;
}

export const projectForNative = (definition, name = definition.metadata.name) => {
  const v = definition.metadata.variant;
  return newProject({ name, kind: 'import', base: {
    [v]: definition, [otherVariant(v)]: toVariant(definition, otherVariant(v)).definition,
  } });
};

export function mergeVariant(project, baseline, variant) {
  if (!has(baseline?.base, variant)) return project;
  const result = { ...project };
  for (const key of ['base', 'style', 'tune', 'overrides']) result[key] = { ...project[key], [variant]: baseline[key][variant] };
  return result;
}
