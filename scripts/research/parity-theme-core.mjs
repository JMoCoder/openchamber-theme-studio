import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import * as core from '../../shared/theme-core.mjs';
import { loadUpstream, MINIMAL, readBuiltins, researchArgs, setPath } from './upstream.mjs';
import { STYLE_PATHS, sentinel } from './style-paths.mjs';

const { source, rest } = researchArgs();
if (rest.some((arg) => arg !== '--write')) throw new Error('仅支持 --write');
const u = await loadUpstream(source);
const c = new u.css.CSSVariableGenerator();
const upstreamPolicy = { syntaxPolicy: 'upstream' };

const seed = 0x286A12FC;
let state = seed;
const random = (limit) => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % limit;
};
const choose = (values) => values[random(values.length)];
const color = () => choose([
  `#${random(16 ** 3).toString(16).padStart(3, '0')}`,
  `#${random(16 ** 4).toString(16).padStart(4, '0')}`,
  `#${random(16 ** 6).toString(16).padStart(6, '0')}`,
  `#${random(16 ** 8).toString(16).padStart(8, '0')}`,
  `rgb(${random(256)}, ${random(256)}, ${random(256)})`,
  `rgb(${random(256)} ${random(256)} ${random(256)} / .42)`,
  `rgba(${random(256)},${random(256)},${random(256)},.65)`,
  'rgb(20% 40% 60% / 70%)', 'rgba(32.5, 85.5, 170.25, .65)',
  `hsl(${random(360)} 65% 40%)`, 'oklch(0.7 0.11 213)', 'rebeccapurple', 'transparent',
  'color(display-p3 .16 .62 .87)', 'color-mix(in srgb, #123 35%, #ffc)', 'light-dark(#eee, #111)',
  '#12345', 'notacolor', ' #abc ',
]);

function check(input, name) {
  const expected = u.definitions.requireTheme(input);
  const parsed = core.parseTheme(input, upstreamPolicy);
  assert.deepStrictEqual(core.validateTheme(input, upstreamPolicy), [], `${name}: expected no issues`);
  assert.deepStrictEqual(parsed, expected, `${name}: resolved fields`);
  assert.deepStrictEqual(core.compactTheme(input, upstreamPolicy), u.definitions.compactTheme(input), `${name}: upstream compaction`);
  assert.deepStrictEqual(core.getReadableThemeColors(parsed), u.readable.getReadableThemeColors(expected), `${name}: readable colors`);
  assert.deepStrictEqual(core.resolveSyntaxTokens(parsed.colors.syntax), u.syntax.resolveSyntaxTokens(expected.colors.syntax), `${name}: syntax tokens`);
  for (const vscode of [false, true]) {
    u.setResearchVSCode(vscode);
    assert.strictEqual(core.generateThemeCss(parsed, { vscode }), c.generate(expected), `${name}: ordered CSS (vscode=${vscode})`);
  }
  const safe = core.inspectThemeImport(input);
  assert.deepStrictEqual(safe.issues, []);
  assert.deepStrictEqual(core.parseTheme(safe.definition), u.definitions.requireTheme(safe.definition), `${name}: sanitized parity`);
  assert.deepStrictEqual(core.parseTheme(core.compactThemeLossless(safe.definition)), core.parseTheme(safe.definition), `${name}: lossless compaction`);
  for (const [fn, args] of [
    ['toHexColor', [parsed.colors.primary.base]],
    ['withOpacity', [parsed.colors.primary.base, 0.42]],
    ['mixColor', [parsed.colors.primary.base, parsed.colors.surface.muted, 0.48, parsed.colors.surface.background]],
    ['tintColor', [parsed.colors.primary.base, parsed.colors.surface.muted, 0.45, parsed.colors.surface.background]],
    ['contrastRatio', [parsed.colors.primary.base, parsed.colors.surface.muted, parsed.colors.surface.background]],
    ['colorHue', [parsed.colors.primary.base, parsed.colors.surface.background]],
    ['chromaticDistance', [parsed.colors.primary.base, parsed.colors.status.error, parsed.colors.surface.muted, parsed.colors.surface.background]],
  ]) assert.deepStrictEqual(core[fn](...args), u.color[fn](...args), `${name}: ${fn}`);
}

const builtins = readBuiltins(source);
for (const item of builtins) check(item.value, item.name);
for (const field of STYLE_PATHS) check((() => {
  const input = structuredClone(MINIMAL);
  setPath(input, field.path.split('.'), sentinel(field));
  return input;
})(), field.path);

const invalidValues = [null, 2, [], {}, '', ' ', 'url(example)', 'var(--sample)', '#xyz', 'red; blue'];
const randomCount = 768;
for (let i = 0; i < randomCount; i++) {
  const input = structuredClone(i % 3 === 0 ? MINIMAL : choose(builtins).value);
  for (let j = 1 + random(15); j > 0; j--) {
    const field = choose(STYLE_PATHS);
    setPath(input, field.path.split('.'), field.type === 'color' ? color() : sentinel(field, Boolean(random(2))));
  }
  if (i % 13 === 0) setPath(input, ['colors', 'syntax', 'tokens', 'futureToken'], color());
  if (i % 17 === 0) setPath(input, ['colors', 'syntax', 'highlights', 'futureHighlight'], color());
  if (i % 19 === 0) {
    // A canonical default with a changed dependency: upstream may compact the override,
    // but safe export must keep the original effective value.
    const automatic = u.definitions.requireTheme(input).colors.interactive.selectionForeground;
    input.colors.interactive.selectionForeground = automatic;
    input.colors.interactive.selection = '#000000';
  }
  check(input, `random-${i}`);
  if (i < 128) {
    const bad = structuredClone(input);
    setPath(bad, choose(STYLE_PATHS.filter((item) => item.type === 'color')).path.split('.'), choose(invalidValues));
    const expected = u.definitions.themeSchema.safeParse(bad);
    assert.equal(expected.success, false, `invalid-${i} fixture`);
    assert.deepStrictEqual(core.validateTheme(bad, upstreamPolicy), expected.error.issues, `invalid-${i} issues`);
  }
}

// String-only boundary check: an inert punctuation-bearing key, no extra CSS rule.
const unknown = structuredClone(MINIMAL);
setPath(unknown, ['colors', 'syntax', 'tokens', 'unknown;key'], '#123456');
const accepted = u.definitions.requireTheme(unknown);
assert.ok(accepted.colors.syntax.tokens['unknown;key']);
assert.ok(c.generate(accepted).includes('--syntax-unknown;key:'));
const hardened = core.inspectThemeImport(unknown);
assert.equal(hardened.issues.length, 0);
assert.deepStrictEqual(hardened.warnings.map((item) => item.path), [['colors', 'syntax', 'tokens', 'unknown;key']]);
assert.ok(!Object.hasOwn(hardened.definition.colors.syntax.tokens, 'unknown;key'));
assert.ok(!Object.keys(core.themeToCssVariables(accepted)).includes('--syntax-unknown;key'));

const report = [
  `PASS · Bun ${Bun.version} · Zod ${u.zodVersion}（上游补丁：${u.zodPatched ? '已用' : '无'}）`,
  `- ${builtins.length} 个原版内置主题；${STYLE_PATHS.length} 个逐字段独立变异；${randomCount} 个可复现随机主题（种子 0x${seed.toString(16)}）；128 个无效输入。`,
  '- 逐字段深相等：解析结果（含 undefined）、上游精简结果、可读色、语法继承、颜色工具、无效输入问题数组。',
  '- 桌面/网页与 VS Code 路径分别对拍，CSS 声明文本（顺序、重复项、!important）逐字符相等。',
  '- 任意语法键仅在研究模式比对；默认导入清理未知键并提示；批准键保留，安全精简保持整体解析结果。',
  '- 未启动 OpenChamber；仅直接编译上游模块，运行环境识别布尔值由脚本控制；未改上游和配置。',
].join('\n') + '\n';
if (rest.includes('--write')) writeFileSync(fileURLToPath(new URL('../../docs/research/evidence/core-parity.txt', import.meta.url)), report);
process.stdout.write(report);
