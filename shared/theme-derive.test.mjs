import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColor, validateTheme } from './theme-core.mjs';
import { adjustTheme, auditTheme, deriveTheme, extractSeeds, randomTheme, repairTheme, SYNTAX_STRATEGIES, toVariant } from './theme-derive.mjs';
import { get, syntaxPairs, view } from './theme-derive-audit.mjs';
import { angleGap, delta, lab, lch, rgb } from './theme-derive-color.mjs';

export function deterministic(seed) {
  let state = seed >>> 0;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  return { next, hex: () => `#${Math.floor(next() * 0x100000000).toString(16).padStart(8, '0')}` };
}
const roll = deterministic(0x7e44ca11);
const variant = (i) => i % 2 ? 'dark' : 'light';
const failures = (definition) => auditTheme(definition).issues.filter(({ severity }) => severity === 'error');
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('derive: 256 random seeds, even extreme translucent inputs produce compact, readable themes', (t) => {
  let maxWritten = 0;
  for (let i = 0; i < 256; i++) {
    const seeds = {
      variant: variant(i), background: roll.hex(), accent: roll.hex(), foreground: i % 3 === 0 ? roll.hex() : undefined,
      temperature: roll.next() * 2 - 1, contrast: roll.next() * 2 - 1, syntaxStrategy: SYNTAX_STRATEGIES[i % 3],
      id: `seed-${i}`, name: `种子 ${i}`,
    };
    const definition = deriveTheme(seeds);
    assert.equal(definition.metadata.variant, seeds.variant);
    assert.equal(definition.metadata.id, seeds.id);
    assert.deepEqual(validateTheme(definition), [], `${i}`);
    assert.deepEqual(failures(definition), [], `${i}`);
    const fields = Object.keys(definition.colors).reduce((sum, key) => {
      const count = (object) => Object.values(object).reduce((n, value) => n + (typeof value === 'string' ? 1 : count(value)), 0);
      return sum + count(definition.colors[key]);
    }, 3);
    maxWritten = Math.max(maxWritten, fields);
    assert.ok(fields <= 36, `${i}: derived theme materialized ${fields} fields`);
  }
  t.diagnostic(`256 seeds; at most ${maxWritten} authored fields, including required metadata`);
  assert.throws(() => deriveTheme({ background: 'rebeccapurple' }), /HEX/);
});

test('inspiration and pairing: 192 reproducible, readable pairs, not channel inversion', (t) => {
  const through = new Set();
  for (let i = 0; i < 192; i++) {
    const source = freeze(randomTheme(`shades-${i}`, { variant: variant(i), id: `pair-${i}-${variant(i)}` }));
    assert.deepEqual(source, randomTheme(`shades-${i}`, { variant: variant(i), id: `pair-${i}-${variant(i)}` }));
    const result = toVariant(source);
    const dest = result.definition;
    assert.notEqual(dest.metadata.variant, source.metadata.variant);
    assert.equal(dest.metadata.id, `pair-${i}-${dest.metadata.variant}`);
    assert.deepEqual(validateTheme(dest), [], `${i}`);
    assert.deepEqual(failures(source), [], `${i} source`);
    assert.deepEqual(failures(dest), [], `${i} destination`);
    assert.deepEqual(toVariant(dest, dest.metadata.variant), { definition: dest, changes: [] });
    const a = lch(rgb(source.colors.primary.base)), b = lch(rgb(dest.colors.primary.base));
    assert.ok(angleGap(a.h, b.h) <= 8, `hue drift in ${i}: ${a.h}/${b.h}`);
    assert.notEqual(dest.colors.primary.base, `#${(0xffffff ^ Number.parseInt(source.colors.primary.base.slice(1), 16)).toString(16).padStart(6, '0')}`);
    through.add(source.colors.primary.base);
  }
  assert.ok(through.size > 140);
  t.diagnostic(`192 pairs, ${through.size} distinct inspiration accents`);
});

test('overall tuning: 192 parameter sets preserve alpha, grouping, state hue and established code distinctions', (t) => {
  let changed = 0;
  for (let i = 0; i < 192; i++) {
    const source = randomTheme(i, { variant: variant(i) });
    source.colors.interactive.selection = `rgba(44,122,154,${i % 7 === 0 ? '0.00000013' : '0.427'})`;
    freeze(source);
    const group = ['all', 'interaction', 'surfaces', 'syntax', 'status', 'accent'][i % 6];
    const options = { group, hue: roll.next() * 360 - 180, chroma: roll.next() * 2 - 1,
      lightness: roll.next() * 2 - 1, contrast: roll.next() * 2 - 1, temperature: roll.next() * 2 - 1 };
    const outcome = adjustTheme(source, options);
    assert.deepEqual(outcome, adjustTheme(source, options), `${i} determinism`);
    assert.deepEqual(validateTheme(outcome.definition), [], `${i} schema`);
    for (const change of outcome.changes) {
      assert.equal(parseColor(change.from).a, parseColor(change.to).a, `${i} ${change.path}`);
      if (group === 'interaction') assert.match(change.path, /^colors\.interactive\./);
      if (group === 'status') assert.match(change.path, /^colors\.status\./);
      if (group === 'syntax') assert.match(change.path, /^colors\.syntax\./);
      if (group === 'surfaces') assert.match(change.path, /^colors\.surface\./);
      if (group === 'accent') assert.match(change.path, /^colors\.(primary|interactive)\./);
    }
    for (const key of ['error', 'warning', 'success', 'info']) {
      const a = lch(rgb(source.colors.status[key])), b = lch(rgb(outcome.definition.colors.status[key]));
      assert.ok(angleGap(a.h, b.h) <= 8, `${i} ${key} hue drift`);
    }
    const before = syntaxPairs(view(source)), after = syntaxPairs(view(outcome.definition));
    for (const [k, { actual }] of before.entries()) assert.ok(after[k].actual + 0.003 >= Math.min(0.052, actual) * 0.94, `${i} code collision ${k}`);
    changed += outcome.changes.length;
    assert.deepEqual(adjustTheme(source, {}), { definition: source, changes: [] });
  }
  assert.ok(changed > 700);
  t.diagnostic(`192 adjustments; ${changed} changes checked for exact alpha`);
});

test('repair: 128 valid themes with isolated failures; keep passing roles and choose a small move', (t) => {
  let maxDelta = 0;
  for (let i = 0; i < 128; i++) {
    const source = randomTheme(`repair-${i}`, { variant: variant(i) });
    const before = repairTheme(source).definition;
    const broken = structuredClone(before);
    const background = broken.colors.surface.background;
    const path = i % 2 ? 'colors.interactive.focusRing' : 'colors.syntax.base.keyword';
    if (i % 2) broken.colors.interactive.focusRing = background;
    else broken.colors.syntax.base.keyword = broken.colors.syntax.base.background ?? background;
    freeze(broken);
    const checks = auditTheme(broken);
    assert.ok(checks.issues.some((item) => item.path === path && item.severity === 'error'));
    const fixed = repairTheme(broken);
    assert.ok(fixed.changes.some((item) => item.path === path));
    assert.deepEqual(failures(fixed.definition), [], `${i}`);
    assert.deepEqual(repairTheme(fixed.definition).changes, [], `${i} repair stability`);
    assert.equal(fixed.definition.colors.primary.base, before.colors.primary.base);
    assert.deepEqual(fixed.definition.colors.status, before.colors.status);
    const difference = delta(lab(rgb(get(broken, path))), lab(rgb(get(fixed.definition, path))));
    maxDelta = Math.max(maxDelta, difference);
    assert.ok(difference < 0.58, `${i}: unnecessary jump to an extreme ${difference}`);
  }
  t.diagnostic(`128 repairs; largest ΔOKLab ${maxDelta.toFixed(3)} when the starting value matched its own backdrop`);
});

test('audit explains every type of issue without treating a display fallback as verified contrast', () => {
  const source = deriveTheme();
  source.colors.markdown = { link: 'oklch(50% 0.11 245)' };
  source.colors.surface.muted = 'rgba(241,240,245,.4)';
  source.colors.surface.elevated = source.colors.surface.background;
  source.colors.interactive.focusRing = '#ffffff01';
  source.colors.interactive.selection = '#00000000';
  source.colors.status.error = source.colors.primary.base;
  source.colors.syntax.highlights = { diffAdded: '#b63838', diffRemoved: '#b63838' };
  source.colors.primary.active = '#123456';
  source.colors.syntax.tokens = { invented: '#224488' };
  source.config = { transitions: { fast: '120ms' } };
  const report = auditTheme(source);
  for (const code of ['contrast', 'boundary', 'layer', 'soft-border', 'status-hue', 'status-accent', 'diff-cvd', 'unknown-key', 'unused-field', 'not-computable', 'hex-only', 'alpha-dropped']) {
    assert.ok(report.issues.some((row) => row.code === code && row.message.zh && row.message.en && row.path), code);
  }
  assert.ok(report.summary.errors > 0 && report.summary.unmeasured > 0 && report.score < 90);
  const item = report.checks.find(({ code, path }) => code === 'contrast' && path === 'colors.markdown.link');
  assert.equal(item.actual, null);
  assert.equal(item.minimum, 4.5);
  assert.equal(item.pass, null);
  assert.equal(auditTheme({ colors: 0 }).status, 'invalid');
  assert.equal(repairTheme(source).definition.colors.markdown.link, 'oklch(50% 0.11 245)');
  assert.notEqual(repairTheme(source, { normalizeUnsupported: true }).definition.colors.markdown.link, 'oklch(50% 0.11 245)');
});

test('image seed extraction handles weighted transparency, diversity, mono, and invalid dimensions', () => {
  const colors = [[250, 242, 226, 255], [144, 37, 96, 255], [40, 100, 180, 210], [1, 230, 10, 0]];
  const width = 30, height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(colors[i < 340 ? 0 : i < 450 ? 1 : i < 550 ? 2 : 3], i * 4);
  const candidates = extractSeeds(data, width, height);
  assert.deepEqual(candidates, extractSeeds(data, width, height));
  assert.ok(candidates.length >= 3 && candidates.length <= 4);
  assert.equal(candidates[0].background, '#faf2e2');
  assert.equal(candidates[0].variant, 'light');
  for (const seed of candidates) {
    assert.ok(seed.coverage.background > 0 && seed.coverage.accent > 0);
    assert.notEqual(seed.accent, '#01e60a');
    assert.deepEqual(failures(deriveTheme(seed)), []);
  }
  assert.deepEqual(extractSeeds(new Uint8Array(4), 1, 1), []);
  assert.equal(extractSeeds([7, 8, 9, 255], 1, 1)[0].variant, 'dark');
  assert.throws(() => extractSeeds(data, 3, 5), RangeError);
});
