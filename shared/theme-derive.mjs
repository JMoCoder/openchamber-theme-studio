import { parseTheme } from './theme-core.mjs';
import { auditTheme, BASE_SYNTAX, edit, EFFECTIVE_FILLS, FIELDS, get, LIVE_COLORS, repairTheme, STATUS, SYNTAX_DELTA, syntaxPairs, view } from './theme-derive-audit.mjs';
import { clamp, hex, lab, lch, number, over, rgb, swatch, turn, under, delta } from './theme-derive-color.mjs';

export { auditTheme, repairTheme };
export const SYNTAX_STRATEGIES = Object.freeze(['balanced', 'analogous', 'duotone']);
export const ADJUST_GROUPS = Object.freeze(['all', 'canvas', 'text', 'accent', 'interaction', 'syntax', 'status', 'details']);

const syntaxSpans = {
  balanced: [36, 0, 143, 110, -54, 24, 81, -88],
  analogous: [0, 22, -36, 72, -12, 49, -78, -48],
  duotone: [0, 5, 158, 143, 0, 133, -16, 38],
};
const syntaxLightness = [0.50, 0.43, 0.49, 0.39, 0.51, 0.43, 0.40, 0.49];
const syntaxDarkness = [0.65, 0.77, 0.80, 0.72, 0.84, 0.74, 0.68, 0.80];

function variantOf(variant) {
  if (variant !== 'light' && variant !== 'dark') throw new RangeError('variant must be "light" or "dark"');
  return variant;
}
function seedColor(value, fallback, variant, name) {
  const parsed = rgb(value ?? fallback);
  if (!parsed) throw new TypeError(`${name}: use HEX or numeric RGB(A)`);
  return over(parsed, under(variant));
}
const validIdentity = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function temperatureLab(color, temperature, size) {
  const { l, x, y } = lab(color);
  const a = x + temperature * size * 0.16, b = y + temperature * size;
  return { l, c: Math.hypot(a, b), h: turn(Math.atan2(b, a) * 180 / Math.PI) };
}

/** Create an editable native definition; optional values are only materialized to fix a visible failure. */
export function deriveTheme({
  variant = 'light', background, accent, foreground, temperature = 0,
  syntaxStrategy = 'balanced', contrast = 0, id, name,
} = {}) {
  variantOf(variant);
  const dark = variant === 'dark';
  const warm = number(temperature, 0, -1, 1), contrastBias = number(contrast, 0, -1, 1);
  const sourceAccent = seedColor(accent, dark ? '#9ba9f8' : '#4e57a3', variant, 'accent');
  const p = lch(sourceAccent);
  const sourceBackground = seedColor(background, dark ? '#19202a' : '#f7f5ee', variant, 'background');
  const s = temperatureLab(sourceBackground, warm, dark ? 0.034 : 0.020);
  const h = s.c < 0.007 ? p.h : s.h;
  const l = clamp(s.l, dark ? 0.13 : 0.904, dark ? 0.27 : 0.976);
  const c = Math.min(s.c, dark ? 0.052 : 0.033);
  const fill = (tone, amount = 1) => swatch(tone, c * amount, h);
  const baseText = foreground === undefined ? null : lch(seedColor(foreground, '#20201f', variant, 'foreground'), h);
  const textL = baseText ? clamp(baseText.l, dark ? 0.76 : 0.15, dark ? 0.985 : 0.344) : dark ? 0.908 : 0.232;
  const emphasisDelta = contrastBias * (dark ? 0.043 : -0.044);
  const front = swatch(textL + emphasisDelta, baseText ? Math.min(baseText.c, 0.09) : c * 0.6, baseText?.h ?? h);
  const syntax = Object.hasOwn(syntaxSpans, syntaxStrategy) ? syntaxSpans[syntaxStrategy] : syntaxSpans.balanced;
  const definition = {
    metadata: { id: validIdentity(id, `theme-studio-seed-${variant}`), name: validIdentity(name, dark ? '深色主题' : '浅色主题'), variant },
    colors: {
      primary: { base: swatch(clamp(p.l, dark ? 0.68 : 0.39, dark ? 0.83 : 0.525) + emphasisDelta, Math.min(p.c, 0.233), p.h) },
      surface: {
        background: fill(l),
        foreground: front,
        muted: fill(dark ? l + 0.041 : l - 0.052, 1.14),
        mutedForeground: swatch((dark ? 0.715 : 0.454) + emphasisDelta * 0.55, Math.min(0.032, c * 0.9), h),
        elevated: fill(dark ? l + 0.088 : Math.min(0.999, Math.max(l + 0.032, 0.97)), 0.62),
      },
      interactive: { border: swatch((dark ? 0.567 : 0.557) + emphasisDelta * 0.35, Math.min(0.045, c * 1.2), h) },
      status: Object.fromEntries(Object.entries(STATUS).map(([key, [hue]], i) => [
        key, swatch((dark ? [0.684, 0.803, 0.73, 0.732] : [0.516, 0.547, 0.491, 0.52])[i] + emphasisDelta * 0.65,
          [0.169, 0.119, 0.123, 0.123][i], hue),
      ])),
      syntax: { base: Object.fromEntries(BASE_SYNTAX.map((key, i) => [
        key, swatch((dark ? syntaxDarkness : syntaxLightness)[i] + emphasisDelta * 0.56,
          i === 0 ? Math.min(0.043, c * 0.65 + 0.012) : Math.min(0.18, Math.max(0.086, p.c * 0.72 + (i % 3) * 0.014)),
          (i === 0 ? h : p.h) + syntax[i]),
      ])) },
    },
  };
  return repairTheme(definition).definition;
}

const FILLS = new Set(Object.values(EFFECTIVE_FILLS).filter((path) => !['primary.base', 'status.error', 'status.info'].includes(path)));
const TEXT_SURFACE = new Set(['foreground', 'mutedForeground', 'elevatedForeground']);
function groupFor(path) {
  const [, family, leaf] = path.split('.');
  if (family === 'surface') return TEXT_SURFACE.has(leaf) ? 'text' : 'canvas';
  if (family === 'primary') return leaf === 'foreground' ? 'text' : 'accent';
  if (family === 'interactive') return 'interaction';
  if (family === 'syntax' || family === 'status') return family;
  return 'details';
}

/** New variant with its own identity, preserving palette roles rather than RGB inversion. */
export function toVariant(definition, variant, { id, name } = {}) {
  const source = view(definition);
  const target = variantOf(variant ?? (source.dark ? 'light' : 'dark'));
  const dark = target === 'dark', editor = edit(definition);
  if (target === source.variant) {
    if (id !== undefined) editor.set('metadata.id', validIdentity(id, source.parsed.metadata.id), 'identity');
    if (name !== undefined) editor.set('metadata.name', validIdentity(name, source.parsed.metadata.name), 'identity');
    return editor.result();
  }
  const canvas = source.canvas ?? under(source.variant);
  const from = lch(canvas), accent = lch(source.color('primary.base') ?? (source.dark ? rgb('#9ba9f8') : rgb('#5059aa')));
  const direction = dark ? 1 : -1;
  const targetCanvas = dark ? clamp(0.205 - (from.l - 0.94) * 0.75, 0.13, 0.27) : clamp(0.959 - (from.l - 0.20) * 0.34, 0.901, 0.978);
  editor.set('metadata.variant', target, 'variant');
  const baseId = source.parsed.metadata.id.replace(/-(light|dark)$/, '');
  editor.set('metadata.id', validIdentity(id, `${baseId}-${target}`), 'identity');
  if (name !== undefined) editor.set('metadata.name', validIdentity(name, source.parsed.metadata.name), 'identity');
  for (const field of LIVE_COLORS) {
    const original = get(definition, field.path);
    if (original === undefined) continue;
    const input = rgb(original);
    if (!input) continue;
    const short = field.path.slice(7), color = lch(input, from.h), { c, h, a } = color;
    let tone, chroma;
    if (short === 'surface.background') {
      tone = targetCanvas; chroma = Math.min(c, dark ? 0.061 : 0.034);
    } else if (short === 'surface.elevated') {
      tone = dark ? targetCanvas + 0.081 : clamp(targetCanvas + 0.033, 0.941, 0.997);
      chroma = Math.min(c, dark ? 0.068 : 0.036);
    } else if (short === 'surface.muted') {
      tone = targetCanvas + direction * clamp(Math.abs(color.l - from.l), 0.047, 0.097);
      chroma = Math.min(c, dark ? 0.089 : 0.048);
    } else if (short.endsWith('Foreground') && (short.startsWith('status.') || short === 'interactive.selectionForeground') || short === 'primary.foreground') {
      // Foregrounds on coloured chips/selection are fit against the new
      // chip, not against the canvas tone window.
      tone = 1 - Math.min(0.98, Math.max(0.025, color.l)); chroma = Math.min(c, 0.07);
    } else if (FILLS.has(short)) {
      const difference = Math.abs(color.l - from.l);
      const isHeavy = short === 'interactive.selection' && a > 0.75 || short === 'surface.overlay';
      tone = isHeavy ? (dark ? 0.82 : 0.24) : a < 0.95 ? clamp(targetCanvas + direction * Math.max(0.32, difference), 0.12, 0.90)
        : clamp(targetCanvas + direction * Math.min(difference, dark ? 0.12 : 0.104), 0.075, 0.997);
      chroma = Math.min(c, isHeavy ? 0.16 : dark ? 0.10 : 0.062);
    } else if (short === 'primary.base') {
      tone = dark ? clamp(0.735 + (0.51 - accent.l) * 0.25, 0.665, 0.815) : clamp(0.507 + (0.735 - accent.l) * 0.19, 0.395, 0.56);
      chroma = Math.min(c, 0.235);
    } else {
      const distance = clamp(Math.abs(color.l - from.l), 0, 0.85);
      const mute = ['interactive.border', 'interactive.borderHover', 'tools.border', 'markdown.hr'].includes(short);
      const main = ['surface.foreground', 'surface.elevatedForeground', 'syntax.base.foreground'].includes(short);
      tone = mute ? (dark ? 0.48 : 0.60) + direction * distance * 0.18
        : main ? (dark ? 0.78 : 0.37) + direction * distance * 0.20
          : dark ? 0.57 + distance * 0.31 : 0.59 - distance * 0.30;
      chroma = Math.min(c * (dark ? 1.07 : 0.95), 0.241);
    }
    editor.set(field.path, swatch(tone, chroma, h, a), 'variant');
  }
  // Respect non-numeric authored CSS. Its limits remain visible in audit.
  const corrected = repairTheme(editor.draft);
  for (const { path, to, reason } of corrected.changes) editor.set(path, to, reason);
  return editor.result();
}

function groupsOf({ groups, group }) {
  const requested = groups ?? group ?? 'all';
  const list = Array.isArray(requested) ? requested : [requested];
  const invalid = list.find((item) => !ADJUST_GROUPS.includes(item) && ![...FIELDS.values()].some((field) => field.group === item));
  if (invalid !== undefined) throw new RangeError(`Unknown theme adjustment group: ${invalid}`);
  return new Set(list);
}

function rotate(color, path, parameters, protectedStatus, canvasL, dark, strength) {
  const value = lch(color);
  const h = value.h * Math.PI / 180;
  const temp = protectedStatus ? 0 : parameters.temperature * 0.052 * strength;
  const chromaScale = 1 + parameters.chroma * 0.78 * strength;
  const scale = protectedStatus ? Math.max(0.78, chromaScale) : chromaScale;
  const x = Math.cos(h) * value.c * scale + 0.18 * temp;
  const y = Math.sin(h) * value.c * scale + temp;
  const anchor = FILLS.has(path) || path === 'surface.overlay' ? (dark ? 0.16 : 0.95) : canvasL;
  const l = value.l + (parameters.lightness * 0.17 + (value.l - anchor) * parameters.contrast * 0.38) * strength;
  const tone = protectedStatus && !FILLS.has(path) ? clamp(l, dark ? 0.49 : 0.31, dark ? 0.93 : 0.72) : l;
  const hue = protectedStatus ? value.h : Math.atan2(y, x) * 180 / Math.PI + parameters.hue * strength;
  const chroma = Math.max(protectedStatus && value.c >= 0.054 ? 0.054 : 0, Math.hypot(x, y));
  return swatch(tone, Math.min(0.32, chroma), hue, color.a);
}

/**
 * A non-cumulative slider transform: call against the drag start definition.
 * Unlike repair, tuning preserves authored alpha and is allowed to lower
 * contrast; audit can explain the result before anything is applied.
 */
export function adjustTheme(definition, options = {}) {
  const model = view(definition), groups = groupsOf(options);
  const knobs = {
    hue: number(options.hue, 0, -180, 180), chroma: number(options.chroma, 0, -1, 1),
    lightness: number(options.lightness, 0, -1, 1), contrast: number(options.contrast, 0, -1, 1),
    temperature: number(options.temperature, 0, -1, 1),
  };
  if (!Object.values(knobs).some(Boolean)) return { definition, changes: [] };
  const preserveStatus = options.protectStatus !== false, preserveSyntax = options.protectSyntax !== false;
  const canvasL = model.canvas ? lab(model.canvas).l : model.dark ? 0.2 : 0.95;
  const editor = edit(definition), syntaxEdits = [];
  for (const field of LIVE_COLORS) {
    if (!groups.has('all') && !groups.has(groupFor(field.path)) && !groups.has(field.group)) continue;
    const value = get(definition, field.path), color = rgb(value);
    if (!color) continue;
    const path = field.path.slice(7);
    const status = preserveStatus && (field.path.startsWith('colors.status.') || /^syntax\.highlights\.diff(Added|Removed|Modified)/.test(path)
      || ['pr.open', 'pr.blocked', 'pr.closed', 'tools.edit.addedBackground', 'tools.edit.removedBackground'].includes(path));
    // Hue / temperature alone must be an exact identity for protected colours.
    if (status && !knobs.chroma && !knobs.lightness && !knobs.contrast) continue;
    const outcome = rotate(color, path, knobs, status, canvasL, model.dark, 1);
    if (hex(color) === outcome) continue;
    editor.set(field.path, outcome, 'adjust');
    if (path.startsWith('syntax.base.') && BASE_SYNTAX.includes(path.split('.').at(-1))) syntaxEdits.push({ path, value, color, status });
  }
  if (preserveSyntax && syntaxEdits.length) {
    const before = syntaxPairs(model);
    for (const dial of [0.5, 0.25, 0]) {
      const after = syntaxPairs(view(editor.draft));
      // Keep distinctions already present; do not invent new semantics in a
      // deliberately monochrome source. The last step is exact restoration.
      if (before.every(({ actual }, i) => actual === null || after[i].actual === null
        || after[i].actual >= Math.min(SYNTAX_DELTA, actual) * 0.94)) break;
      for (const item of syntaxEdits) {
        const next = dial ? rotate(item.color, item.path, knobs, item.status, canvasL, model.dark, dial) : item.value;
        editor.set(`colors.${item.path}`, next, 'protect-syntax');
      }
    }
  }
  return editor.result();
}

/** Weighted colour clues, not a promise that a photographed pair is readable on its own. */
export function extractSeeds(pixels, width, height, { limit = 4 } = {}) {
  const size = width * height;
  if ((!ArrayBuffer.isView(pixels) && !Array.isArray(pixels)) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || !Number.isSafeInteger(size * 4) || pixels.length !== size * 4) throw new RangeError('RGBA length must be width × height × 4');
  const bins = new Map();
  const stepX = Math.max(1, Math.ceil(width / Math.min(width, Math.max(1, Math.sqrt(24000 * width / height)))));
  const stepY = Math.max(1, Math.ceil(height / Math.min(height, Math.max(1, 24000 * stepX / width))));
  let total = 0;
  for (let y = 0; y < height; y += stepY) for (let x = 0; x < width; x += stepX) {
    const index = (y * width + x) * 4;
    const a = number(pixels[index + 3], 0, 0, 255) / 255;
    if (a < 0.12) continue;
    const color = { r: number(pixels[index], 0, 0, 255), g: number(pixels[index + 1], 0, 0, 255), b: number(pixels[index + 2], 0, 0, 255), a: 1 };
    const { l, x: chromaX, y: chromaY } = lab(color);
    const key = `${Math.round(l / 0.10)},${Math.round(chromaX / 0.055)},${Math.round(chromaY / 0.055)}`;
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    bin.r += color.r * a; bin.g += color.g * a; bin.b += color.b * a; bin.weight += a; total += a;
    bins.set(key, bin);
  }
  const swatches = [...bins.values()].sort((a, b) => b.weight - a.weight).slice(0, 48).map(({ r, g, b, weight }) => {
    const color = { r: r / weight, g: g / weight, b: b / weight, a: 1 };
    return { color, value: hex(color), tone: lch(color), lab: lab(color), proportion: weight / total };
  });
  if (!swatches.length) return [];
  const backgrounds = [];
  for (const swatch of swatches) {
    if (swatch.proportion < 0.03 || backgrounds.some((other) => delta(swatch.lab, other.lab) < 0.18)) continue;
    backgrounds.push(swatch);
    if (backgrounds.length === 3) break;
  }
  if (!backgrounds.length) backgrounds.push(swatches[0]);
  const cap = Math.floor(number(limit, 4, 1, 8)), output = [];
  for (let round = 0; round < cap && output.length < cap; round++) for (const base of backgrounds) {
    const eligible = swatches.filter((item) => delta(item.lab, base.lab) > 0.095 && item.proportion >= 0.009);
    const quality = (item) => 0.54 * item.tone.c + 0.21 * delta(item.lab, base.lab) + 0.18 * Math.sqrt(item.proportion) - 0.16 * Math.abs(item.tone.l - 0.60);
    const accents = eligible.sort((a, b) => quality(b) - quality(a));
    const ink = swatches.find((item) => base.tone.l >= 0.57 ? item.tone.l < 0.36 : item.tone.l > 0.78);
    const accent = accents[round] ?? (round === 0 ? base : null);
    if (!accent) continue;
    output.push({ variant: base.tone.l < 0.57 ? 'dark' : 'light', background: base.value, accent: accent.value,
      ...(ink && ink !== accent ? { foreground: ink.value } : {}),
      coverage: { background: base.proportion, accent: accent.proportion } });
    if (output.length >= cap) break;
  }
  return output;
}

function rng(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  let state = hash || 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Same supplied seed and options give the same editable definition. */
export function randomTheme(seed, { variant, id, name } = {}) {
  const next = rng(seed ?? 'openchamber');
  const mode = variantOf(variant ?? (next() < 0.5 ? 'light' : 'dark'));
  const dark = mode === 'dark', hue = 360 * next();
  const offset = [0, 24, -37, 75, 155][Math.floor(next() * 5)];
  const background = swatch((dark ? 0.158 : 0.933) + next() * (dark ? 0.068 : 0.048),
    (dark ? 0.016 : 0.007) + next() * (dark ? 0.036 : 0.022), hue + offset);
  const accent = swatch((dark ? 0.69 : 0.44) + next() * 0.098, 0.096 + next() * 0.106, hue);
  return deriveTheme({ variant: mode, background, accent, temperature: next() * 0.62 - 0.31, contrast: next() * 0.65 - 0.20,
    syntaxStrategy: SYNTAX_STRATEGIES[Math.floor(next() * SYNTAX_STRATEGIES.length)], id, name: name ?? (dark ? '随机灵感 · 深色' : '随机灵感 · 浅色') });
}
