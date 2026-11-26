import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STYLE_RECIPES, applyStyleRecipe } from './style-recipes.mjs';
import { auditTheme, deriveTheme, randomTheme, toVariant } from './theme-derive.mjs';
import { parseColor, resolveSyntaxTokens, validateTheme } from './theme-core.mjs';
import { BASE_SYNTAX, get, LIVE_COLORS, view } from './theme-derive-audit.mjs';
import { delta, hex, lab, lch, ratio } from './theme-derive-color.mjs';
import { materialGuardrails, SIGNATURE_AXES, STOCK_P90, structuralSignature, styleGuardrails } from './style-recipes-guards.mjs';
import { isMaterial } from './style-recipes-materials.mjs';
import catalog from '../data/fields.json' with { type: 'json' };

const fieldByPath = new Map(catalog.fields.map((item) => [item.path, item]));
const settingsByKey = new Map(catalog.settings.map((item) => [item.key, item]));
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const data = (dir) => readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'index.json').sort()
  .map((name) => [name, freeze(JSON.parse(readFileSync(join(dir, name), 'utf8')))]);
const optionCases = (recipe) => recipe.options.reduce((cases, { key, choices }) =>
  cases.flatMap((flags) => choices.map(({ value }) => ({ ...flags, [key]: value }))), [{}]);
const recipes = STYLE_RECIPES.map((recipe) => ({ recipe, cases: optionCases(recipe) }));
const proofPath = process.env.THEME_STUDIO_LEGACY;
const legacy = proofPath && new Map((await import(pathToFileURL(join(proofPath, 'shared/style-recipes.mjs')).href))
  .STYLE_RECIPES.map((recipe) => [recipe.id, recipe]));
const paperWeights = { canvas: 4, muted: 3, elevated: 2, bubble: 1, selection: 1, code: 1 };
const paperVector = (model) => Object.keys(paperWeights).map((name) => lab(model.back(name)));
const paperDistance = (a, b) => Math.sqrt(Object.values(paperWeights)
  .reduce((sum, weight, i) => sum + weight * delta(a[i], b[i]) ** 2, 0) / 12);
const coreSyntax = ['keyword', 'string', 'number', 'function', 'comment'];
const coreSyntaxMinimum = 0.052;
const pixelRoles = LIVE_COLORS.map(({ path }) => path.slice(7)).filter((path) => !/^(pr\.|status\.|syntax\.highlights\.diff)/.test(path));

function acceptable(result, label) {
  assert.deepEqual(validateTheme(result.definition), [], label);
  const audit = auditTheme(result.definition);
  const violations = audit.issues.filter(({ severity, code }) => severity === 'error' || code === 'status-hue' || code === 'status-accent' || code === 'not-computable');
  assert.equal(audit.summary.unmeasured, 0, label);
  assert.deepEqual(violations.map((v) => [v.code, v.path, v.against, v.actual]), [], label);
  for (const { path, to } of result.changes) {
    const field = fieldByPath.get(path);
    assert.ok(field && field.effect.kind !== 'dead' && field.type === 'color', `${label} changed ${path}`);
    assert.ok(parseColor(to) && !/!important/i.test(to), `${label} unsupported output ${to}`);
  }
  return audit;
}

function materialReadability(model, audit, label, floor) {
  const check = (colour, fills) => {
    for (const role of fills) {
      const value = ratio(colour, model.back(role));
      floor.text = Math.min(floor.text, value);
      assert.ok(value >= 4.5, `${label} ${hex(colour)} on ${role}: ${value}`);
    }
  };
  const diff = audit.checks.filter(({ code }) => code === 'diff-cvd');
  for (const item of diff) {
    const kind = item.path.startsWith('colors.syntax') ? 'diffMarker' : 'diffFill';
    floor[kind] = Math.min(floor[kind], item.actual);
    assert.ok(item.pass, `${label} ${item.path} diff colour-vision distance: ${item.actual}`);
  }
  const required = ['foreground', 'mutedForeground', 'elevatedForeground'];
  for (const ink of required) check(model.color(`surface.${ink}`), ['canvas', 'muted', 'elevated', 'bubble', 'hover', 'active', 'selection']);
  for (const role of ['link', 'linkHover']) check(model.color(`markdown.${role}`), ['canvas', 'muted', 'elevated', 'bubble']);
  const syntax = model.definition.colors.syntax;
  const inks = [...BASE_SYNTAX, 'foreground'].map((name) => model.color(`syntax.base.${name}`));
  const aliases = Object.entries(resolveSyntaxTokens(syntax))
    .filter(([key]) => fieldByPath.get(`colors.syntax.tokens.${key}`)?.effect.kind !== 'dead').map(([, ink]) => ink);
  for (const ink of [...new Set([...inks.map(hex), ...aliases])].map(parseColor)) {
    check(ink, ['code', 'elevated', 'subtle', 'toolAdded', 'toolRemoved', 'textMateAdded', 'textMateRemoved']);
  }
  const essential = coreSyntax.map((key) => lab(model.color(`syntax.base.${key}`)));
  for (let i = 0; i < essential.length; i++) for (let j = i + 1; j < essential.length; j++) {
    const distance = delta(essential[i], essential[j]);
    floor.syntax = Math.min(floor.syntax, distance);
    assert.ok(distance >= coreSyntaxMinimum, `${label} syntax ${coreSyntax[i]} vs ${coreSyntax[j]}: ${distance}`);
  }
  for (const group of [
    ['status.error', 'status.warning', 'status.success', 'status.info'],
    ['pr.open', 'pr.draft', 'pr.blocked', 'pr.merged', 'pr.closed'],
  ]) {
    const colors = group.map(model.color).map(lab);
    for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
      const distance = delta(colors[i], colors[j]);
      floor.semantic = Math.min(floor.semantic, distance);
      assert.ok(distance >= 0.045, `${label} ${group[i]} vs ${group[j]}: ${distance}`);
    }
  }
}

function crossProduct(themes, t) {
  let evaluated = 0, repeats = 0, signatures = 0, least = Infinity;
  let selectedTextFloor = Infinity, selectedMarkFloor = Infinity;
  let oldComparisons = 0, compared = 0, materialRuns = 0;
  const bytes = createHash('sha256');
  const materialFloor = { text: Infinity, syntax: Infinity, diffMarker: Infinity, diffFill: Infinity, semantic: Infinity };
  const planeStats = {};
  const canvasBands = new Map();
  for (const [name, authored] of themes) for (const base of [authored, freeze(toVariant(authored).definition)]) {
    const candidates = [];
    for (const { recipe, cases } of recipes) for (const flags of cases) for (const strength of
      isMaterial(recipe.id) ? [0, 0.001, 0.25, 0.50, 0.75, 1] : [0, 0.5, 1]) {
      const label = `${name}:${base.metadata.variant} / ${recipe.id} ${JSON.stringify(flags)} @ ${strength}`;
      const result = recipe.apply(base, { strength, ...flags });
      const material = isMaterial(recipe.id), old = legacy && legacy.get(recipe.id);
      if (old) {
        const previous = JSON.stringify(old.apply(base, { strength, ...flags }));
        const current = JSON.stringify(result);
        assert.equal(current, previous, `${label} byte-for-byte result and changes`);
        bytes.update(label).update('\n').update(current).update('\n');
        oldComparisons++;
      }
      evaluated++;
      assert.deepEqual(result.definition.metadata, base.metadata, label);
      assert.deepEqual(result.definition.config, base.config, label);
      if (strength === 0) {
        assert.equal(result.definition, base, label);
        assert.deepEqual(result.changes, [], label);
        continue;
      }
      const audit = acceptable(result, label);
      assert.deepEqual(styleGuardrails(result.definition, recipe.id), [], label);
      const selectedRows = audit.checks.filter(({ code }) => code === 'selected-row-contrast');
      selectedTextFloor = Math.min(selectedTextFloor, ...selectedRows.filter(({ minimum }) => minimum === 4.5).map(({ actual }) => actual));
      selectedMarkFloor = Math.min(selectedMarkFloor, ...selectedRows.filter(({ minimum }) => minimum === 3).map(({ actual }) => actual));
      if (material) {
        materialReadability(view(result.definition), audit, label, materialFloor);
        materialRuns++;
      }
      if (material || strength === 1) {
        const repeat = recipe.apply(result.definition, { strength, ...flags });
        assert.deepEqual(repeat.changes, [], `${label} repeat`);
        assert.deepEqual(repeat.definition, result.definition, `${label} fixed point`);
        repeats++;
      }
      if (strength === 1) {
        assert.deepEqual(materialGuardrails(result.definition, recipe.id), [], label);
        const key = `${base.metadata.variant}/${recipe.id}`;
        const stats = canvasBands.get(key) ?? { min: 1, max: 0 };
        const canvas = lch(view(result.definition).canvas);
        stats.min = Math.min(stats.min, canvas.l);
        stats.max = Math.max(stats.max, canvas.l);
        canvasBands.set(key, stats);
        candidates.push({ id: recipe.id, label, material, planes: paperVector(view(result.definition)),
          sig: material ? null : structuralSignature(result.definition) });
        if (recipe.id === 'pixel-palette') {
          const palette = new Set(pixelRoles.map(view(result.definition).color).filter(Boolean).map(hex));
          assert.equal(palette.size, flags.palette === 'four' ? 5 : 7, `${label} rail colours plus one signal`);
        }
      }
    }
    for (const [i, a] of candidates.entries()) for (const b of candidates.slice(i + 1)) {
      if (a.id !== b.id && !a.material && !b.material) {
        const distance = SIGNATURE_AXES.filter((axis) => a.sig[axis] !== b.sig[axis]).length;
        assert.ok(distance >= 3, `G5 ${distance}/7:\n${a.label} ${JSON.stringify(a.sig)}\n${b.label} ${JSON.stringify(b.sig)}`);
        least = Math.min(least, distance);
        signatures++;
      }
      if (a.id === b.id && !a.material) continue;
      const match = a.id === b.id ? 'editions' : a.material && b.material ? 'new/new'
        : a.material || b.material ? 'new/old' : 'old/old';
      const key = `${base.metadata.variant} ${match}`;
      const stats = planeStats[key] ??= { floor: Infinity, pairs: 0, nearest: [] };
      const distance = paperDistance(a.planes, b.planes);
      const minimum = { 'editions': 0.016, 'new/new': 0.055, 'new/old': 0.058, 'old/old': 0.028 }[match];
      assert.ok(distance >= minimum, `${key} Δ ${distance} < ${minimum}:\n${a.label}\n${b.label}`);
      if (distance < stats.floor) [stats.floor, stats.nearest] = [distance, [a.label, b.label]];
      stats.pairs++;
      compared++;
    }
  }
  const bands = {};
  for (const [key, { min, max }] of canvasBands) {
    const width = max - min;
    if (!isMaterial(key.split('/')[1])) {
      assert.ok(width <= (/brutalism|fauvism|pixel-palette/.test(key) ? 0.02 : 0.012), `${key}: canvas L span ${width}`);
    }
    bands[key] = +width.toFixed(4);
  }
  t.diagnostic(`${themes.length} input files × 2 variants × (30 legacy profiles × 3 strengths + 16 new profiles × 6 strengths) = ${evaluated}; ${repeats} fixed points; ${materialRuns} new positive-strength audits; ${signatures} legacy signature pairs, minimum ${least}/7`);
  if (oldComparisons) t.diagnostic(`${oldComparisons} byte-identical legacy result comparisons; stream SHA-256 ${bytes.digest('hex')}`);
  t.diagnostic(`${compared} large-plane pairs (all options, 100%): ${JSON.stringify(planeStats)}`);
  t.diagnostic(`new native role minimums: ${JSON.stringify(materialFloor)}`);
  t.diagnostic(`selected row: ≥${selectedTextFloor}:1 text, ≥${selectedMarkFloor}:1 PR/status; canvas L by variant/style ${JSON.stringify(bands)}`);
}

const presets = data(fileURLToPath(new URL('../presets/', import.meta.url)));
const visualFamilies = ['quiet-graphite', 'kilnmark', 'reed-shade', 'blue-etch', 'zero-hour', 'wheat-vellum'];

test('new styles: six reference palettes contribute at least three pigment families without repainting stock', (t) => {
  const neutralBands = new Map();
  const variants = {};
  for (const variant of ['light', 'dark']) {
    const references = visualFamilies.map((key) => {
      const theme = presets.find(([file]) => file === `${key}-${variant}.json`)?.[1];
      assert.ok(theme, `${key}-${variant} visual reference`);
      return theme;
    });
    variants[variant] = {};
    for (const { recipe, cases } of recipes.filter(({ recipe }) => isMaterial(recipe.id))) {
      const { id } = recipe;
      variants[variant][id] = [];
      for (const options of cases) {
        const all = references.map((base) => view(recipe.apply(base, options).definition));
        for (const zone of ['canvas', 'muted', 'elevated', 'code']) {
          assert.equal(new Set(all.map((model) => hex(model.back(zone)))).size, 1, `${variant}/${id} fixed ${zone}`);
        }
        assert.equal(new Set(all.map((model) => hex(model.color('interactive.border')))).size, 1, `${variant}/${id} fixed rule`);
        const dynamic = id === 'constructivist' || id === 'thermal-ramp' ? 'accent'
          : id === 'retro-desktop' || id === 'kraft-label' ? 'selection' : 'bubble';
        const visible = all.map((m) => dynamic === 'accent' ? m.color('primary.base') : m.back(dynamic)).map(lab);
        // A lower bound on visibly distinct shades, not arbitrary differing bytes.
        const found = [];
        for (const paint of visible) if (found.every((p) => delta(paint, p) >= 0.040)) found.push(paint);
        assert.ok(found.length >= 3, `${variant}/${id} ${JSON.stringify(options)} ${dynamic}: saw ${found.length} distinct pigments`);
        variants[variant][id].push(found.length);
        if (variant === 'light') {
          const { l, c, h } = lch(all[0].canvas);
          const bin = `${c < 0.015 ? 'neutral' : Math.floor(h / 30)}/${Math.floor(l / 0.07)}`;
          const occupants = neutralBands.get(bin) ?? new Set();
          occupants.add(id);
          neutralBands.set(bin, occupants);
          assert.ok(occupants.size <= 2, `${bin}: too many similarly coloured light canvases (${[...occupants]})`);
        }
      }
    }
  }
  t.diagnostic(`reference shades ≥0.040 by style/edition: ${JSON.stringify(variants)}`);
  t.diagnostic(`light canvas hue/L bands: ${JSON.stringify(Object.fromEntries([...neutralBands].map(([key, group]) => [key, [...group]])))}`);
});

test(`styles: every recipe and option on all ${presets.length} Theme Studio presets`, (t) => {
  assert.ok(presets.length && presets.some(([, theme]) => theme.metadata.variant === 'light') &&
    presets.some(([, theme]) => theme.metadata.variant === 'dark'));
  crossProduct(presets, t);
});

const source = process.env.THEME_STUDIO_UPSTREAM;
test('styles: every recipe and option on all 62 OpenChamber v2.8.0 builtins',
  { skip: source ? false : 'Set THEME_STUDIO_UPSTREAM to a pinned OpenChamber v2.8.0 checkout' }, (t) => {
    const builtin = data(join(source, 'packages/ui/src/lib/theme/themes'));
    assert.equal(builtin.length, 62);
    for (const variant of ['dark', 'light']) {
      const peers = builtin.filter(([, theme]) => theme.metadata.variant === variant).map(([, theme]) => view(theme));
      assert.equal(peers.length, 31);
      for (const [role, expected] of Object.entries(STOCK_P90[variant])) {
        const series = peers.map((model) => lch(model.back(role)).c).sort((a, b) => a - b);
        assert.ok(Math.abs(series[Math.ceil(0.90 * series.length) - 1] - expected) < 1e-9, `${variant}/${role} real P90`);
      }
    }
    crossProduct(builtin, t);
  });

test('styles: arbitrary authoring including incompatible backgrounds, transparent or non-numeric colours', (t) => {
  let state = 0x1be630a5;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const rgba = () => `#${Math.floor(next() * 0x100000000).toString(16).padStart(8, '0')}`;
  function scramble(object) {
    for (const key of Object.keys(object)) {
      if (typeof object[key] === 'object') scramble(object[key]);
      else object[key] = next() < 0.2 ? 'oklch(70% 0.1 220)' : rgba();
    }
  }
  let count = 0, repeats = 0;
  for (let i = 0; i < 96; i++) {
    const theme = deriveTheme({ variant: i % 2 ? 'light' : 'dark', background: rgba(), accent: rgba() });
    scramble(theme.colors);
    for (const path of ['hover', 'active', 'selectionForeground', 'cursor']) theme.colors.interactive[path] = rgba();
    Object.assign(theme.colors.status, {
      errorForeground: rgba(), infoForeground: rgba(), successBackground: rgba(), errorBackground: rgba(),
    });
    theme.colors.tools = { edit: { addedBackground: rgba(), removedBackground: rgba() } };
    theme.config = { fonts: { sans: 'Inter' } };
    freeze(theme);
    assert.deepEqual(validateTheme(theme), [], 'input is difficult, not structurally invalid');
    for (const recipe of STYLE_RECIPES) for (const strength of [0.001, 0.25, 0.5, 1]) {
      const label = `mixed ${i} ${recipe.id} at ${strength}`;
      const flags = optionCases(recipe)[i % 2];
      const output = recipe.apply(theme, { strength, ...flags });
      acceptable(output, label);
      assert.deepEqual(styleGuardrails(output.definition, recipe.id), [], label);
      assert.deepEqual(output.definition.config, theme.config);
      if (strength === 1 || isMaterial(recipe.id)) {
        assert.deepEqual(recipe.apply(output.definition, { ...flags, strength }).changes, [], label);
        repeats++;
      }
      count++;
    }
  }
  t.diagnostic(`${count} positive-strength runs; ${repeats} fixed points`);
});

test('brutalism keeps opaque marks, a quiet editor, and real selected-row inks', () => {
  for (const variant of ['dark', 'light']) {
    const theme = randomTheme('hard-rails', { variant });
    const a = applyStyleRecipe('brutalism', theme, { strength: 1 }).definition;
    const { surface, interactive, status, chat, tools, syntax } = a.colors;
    assert.equal(surface.background, surface.muted);
    assert.equal(syntax.base.background, surface.background);
    assert.equal(interactive.selectionForeground, surface.foreground);
    assert.notEqual(interactive.selection, surface.foreground);
    assert.ok(lch(parseColor(interactive.selection)).c >= 0.095, 'not a pastel or gray highlight');
    assert.ok(lch(parseColor(chat.userMessageBackground)).c >= 0.095, 'a solid coloured message');
    for (const fill of [surface.background, surface.muted, surface.elevated, surface.subtle, interactive.border, interactive.hover, interactive.active,
      interactive.focusRing, chat.userMessageBackground, status.errorBackground, status.successBackground, tools.edit.addedBackground, tools.edit.removedBackground,
      syntax.base.background, syntax.highlights.diffAddedBackground, syntax.highlights.diffRemovedBackground]) assert.equal(parseColor(fill).a, 1);
    const result = auditTheme(a);
    const edges = result.checks.filter(({ code }) => code === 'soft-border');
    const rows = result.checks.filter(({ code }) => code === 'selected-row-contrast');
    assert.equal(rows.length, 10);
    assert.ok(rows.every(({ pass }) => pass));
    assert.deepEqual(edges.map(({ opacityFactor }) => opacityFactor), [0.4, 0.7, 1]);
    assert.ok(edges[0].actual >= (variant === 'dark' ? 2.8 : 2.3) && edges[1].actual >= 3 && edges[2].actual > 10);
  }
});

test('audit finds the old reversal when the selected title passes but global labels and status marks fail', () => {
  const input = deriveTheme({ variant: 'light', background: '#ffffff', accent: '#1144aa' });
  Object.assign(input.colors.interactive, { selection: '#161616', selectionForeground: '#ffffff' });
  input.colors.surface.mutedForeground = '#4a4a4a';
  input.colors.status.success = '#145634';
  const audit = auditTheme(input);
  assert.ok(audit.checks.some(({ code, path, pass }) => code === 'contrast' && path === 'colors.interactive.selectionForeground' && pass));
  assert.ok(audit.issues.some(({ code, path }) => code === 'selected-row-contrast' && path === 'colors.surface.mutedForeground'));
  assert.ok(audit.issues.some(({ code, path }) => code === 'selected-row-contrast' && path === 'colors.pr.open'));
});

test('paint guards reject chlorophyll with lavender, blush on paper, yellow ink and muddy dark stock', () => {
  const light = deriveTheme({ variant: 'light' }), dark = deriveTheme({ variant: 'dark' });
  light.colors.primary.base = '#196547';
  light.colors.surface.muted = '#e7d8f8';
  light.colors.surface.elevated = '#fae1e7';
  light.colors.markdown = { link: '#ad8706' };
  dark.colors.surface.background = '#38261c';
  const failures = styleGuardrails(light, 'brutalism');
  assert(failures.some(({ code, role }) => code === 'G2' && role === 'muted'));
  assert(failures.some(({ code, role }) => code === 'G2' && role === 'elevated'));
  assert(failures.some(({ code, role }) => code === 'G4' && role === 'markdown.link'));
  assert(styleGuardrails(dark, 'soft-glass').some(({ code }) => code === 'warm-dark-plane'));
});

test('styles keep their material while the original palette survives in active marks, ink and selection', () => {
  const identityRoles = ['primary.base', 'markdown.link', 'interactive.selection', 'chat.userMessageBackground', 'syntax.base.keyword'];
  for (const variant of ['light', 'dark']) {
    const peers = presets.filter(([, theme]) => theme.metadata.variant === variant);
    assert.ok(peers.length >= 5);
    for (const { recipe, cases } of recipes) for (const flags of cases) {
      const results = peers.map(([, source]) => view(recipe.apply(source, flags).definition));
      const marks = results.map((model) => identityRoles.map((path) => lab(model.color(path))));
      const distance = (a, b) => Math.max(...a.map((piece, i) => delta(piece, b[i])));
      const different = [];
      for (const mark of marks) if (different.every((previous) => distance(mark, previous) >= 0.016)) different.push(mark);
      assert.ok(different.length >= 5, `${variant}/${recipe.id} ${JSON.stringify(flags)}: too few visible variations in active roles`);
    }
    for (const id of ['brutalism', 'fauvism']) {
      const { recipe } = recipes.find(({ recipe }) => recipe.id === id);
      const choices = recipe.options.find(({ key }) => key === 'palettePair').choices.map(({ value }) => value);
      assert.deepEqual(choices, ['auto', 'signal', 'studio', 'triad']);
      const paths = id === 'brutalism' ? ['chat.userMessageBackground', 'interactive.selection', 'markdown.inlineCodeBackground'] : ['surface.muted','surface.subtle'];
      for (const [file, source] of peers) {
        const marks = choices.map((palettePair) => {
          const output = recipe.apply(source, { palettePair }).definition.colors;
          return paths.map((path) => get(output, path)).join('/');
        });
        assert.ok(new Set(marks).size >= 3, `${file}/${id}: three different native paint arrangements`);
      }
    }
  }
});

test('the catalogue tiers and settings recommendations use the actual public contract', () => {
  assert.equal(catalog.fields.length, 147);
  assert.equal(catalog.settings.length, 67);
  assert.equal(catalog.fields.filter((field) => field.quick).length, 10);
  for (const field of catalog.fields) {
    assert.ok(['basic', 'advanced', 'expert', 'hidden'].includes(field.tier), field.path);
    assert.equal(field.tier === 'hidden', field.effect.kind === 'dead');
    assert.ok(!field.quick || field.tier === 'basic');
  }
  const checkCopy = ({ zh, en }) => {
    assert.doesNotMatch(zh, /色型|槽位|半活|宿主|交互|快照|显式|旧式或内嵌|着色底层|Ghostty/);
    assert.doesNotMatch(en, /\b(host|snapshot|ghostty|consumer|memoization|alias|adapter)\b/i);
  };
  for (const record of [...catalog.fields, ...catalog.settings]) { checkCopy(record.label); checkCopy(record.hint); }
  for (const recipe of STYLE_RECIPES) {
    assert.equal(recipe.limits.length, 2);
    assert.deepEqual(recipe.strength, { min: 0, max: 1, default: 1 });
    for (const localized of [recipe.name, recipe.description, ...recipe.limits,
      ...recipe.options.flatMap(({ label, choices }) => [label, ...choices.map((choice) => choice.label)])]) checkCopy(localized);
    for (const [key, value] of Object.entries(recipe.settings)) {
      const item = settingsByKey.get(key);
      assert.ok(item && item.apply !== 'none' && item.apply !== 'migration' && !item.derived, `${recipe.id} ${key}`);
      if (Array.isArray(item.allowed)) assert.ok(item.allowed.includes(value));
      else if (item.type === 'range') {
        assert.ok(value >= item.allowed.min && value <= item.allowed.max);
        assert.equal((value - item.allowed.min) % item.allowed.step, 0);
      } else if (item.type === 'local-font-names') {
        assert.ok(value.length < item.allowed.maxLength);
        for (const [key, choice] of Object.entries(item.allowed.when)) assert.equal(recipe.settings[key], choice);
      } else assert.fail(`${key}: no validation for ${item.type}`);
    }
  }
  assert.throws(() => applyStyleRecipe('random-invalid-id', {}), RangeError);
  assert.throws(() => applyStyleRecipe('brutalism', {}, { strength: 0 }), /metadata/);
});

test('new styles do not throw or fabricate output for invalid structures', () => {
  for (const { recipe } of recipes.filter(({ recipe }) => isMaterial(recipe.id))) {
    for (const input of [undefined, null, false, [], {}, { metadata: { variant: 'dark' }, colors: { surface: null } }]) {
      for (const strength of [0, 0.001, 0.5, 1]) {
        const result = recipe.apply(input, { strength });
        assert.equal(result.definition, input);
        assert.deepEqual(result.changes, []);
      }
    }
  }
});
