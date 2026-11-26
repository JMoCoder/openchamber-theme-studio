#!/usr/bin/env node
import { deepEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardSwatches } from './presets-generate.mjs';
import { terminalInks } from './presets-terminal.mjs';

const root = fileURLToPath(new URL('../presets/', import.meta.url));
const presetCount = 11;
const modes = ['light', 'dark'];
const syntaxRoles = ['keyword', 'string', 'number', 'function', 'variable', 'type', 'operator'];
const statuses = ['error', 'warning', 'success', 'info'];
const diffRoles = ['Added', 'Removed', 'Modified'];
const prRoles = ['open', 'draft', 'blocked', 'merged', 'closed'];
const layouts = ['soft', 'rail-lift', 'paper', 'bright-card', 'charcoal', 'seam', 'hard', 'signal'];
const surfaceCaps = {
  light: { canvas: 0.015, sidebar: 0.019, elevated: 0.019 },
  dark: { canvas: 0.023, sidebar: 0.023, elevated: 0.023 },
};
// Exact slug and mode are required. A manifest flag cannot grant an exception
// by itself, and any slot omitted here retains the normal cap.
const surfaceExceptions = new Map([
  ['blue-etch', {
    light: { tag: 'blueprint-paper', surfaces: { canvas: 0.043, sidebar: 0.043, elevated: 0.031 } },
    dark: { tag: 'prussian-blueprint', surfaces: { canvas: 0.061, sidebar: 0.061, elevated: 0.061 } },
  }],
  ['afterglow', {
    // Daylight is on the page, not the rail. At night the larger indigo
    // planes distinguish the palette from graphite and gray-violet.
    light: { tag: 'periwinkle-rail', surfaces: { sidebar: 0.058 } },
    // A small copper message echoes the daylight coral without warming the
    // main workspace. The normal warm cap still applies to code and subtle.
    dark: { tag: 'indigo-night', surfaces: { canvas: 0.070, sidebar: 0.082, elevated: 0.066 }, warm: { bubble: 0.066 } },
  }],
  ['hojicha', {
    // Separate cream and tea by both lightness and color; keep roasted
    // coffee on three dark planes and reserve caramel for the message.
    light: { tag: 'tea-cream', surfaces: { canvas: 0.032, sidebar: 0.072 } },
    dark: { tag: 'espresso-night', surfaces: { canvas: 0.037, sidebar: 0.030, elevated: 0.034 },
      warm: { canvas: 0.037, sidebar: 0.030, elevated: 0.034, bubble: 0.054 } },
  }],
]);
const hexLiteral = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const solidLiteral = /^#[0-9a-f]{6}$/i;
const flags = { json: false, upstream: null, sheet: false };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--json') flags.json = true;
  else if (process.argv[i] === '--check-sheet') flags.sheet = true;
  else if (process.argv[i] === '--upstream' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    flags.upstream = resolve(process.argv[++i], 'packages/ui/src/lib/theme/themes');
  } else {
    throw new Error('用法：node scripts/check-presets.mjs [--upstream <OpenChamber 源码根目录>] [--check-sheet] [--json]');
  }
}
const json = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const errors = [];
function check(condition, label) { if (!condition) errors.push(label); }
function keys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (!value || Array.isArray(value) || typeof value !== 'object' || actual.join(' ') !== wanted.join(' ')) {
    throw new Error(`${label}：预期字段 ${wanted.join(', ')}；实际 ${actual.join(', ')}`);
  }
}
const fields = (value) => value.split(' ');
const f = (v, digits = 3) => v.toFixed(digits);

// sRGB alpha-over (like browser color-mix(in srgb, …, transparent)), then WCAG luminance.
function rgb(value) {
  if (Array.isArray(value)) return value;
  const normalized = value.length < 6 ? [...value.slice(1)].map((c) => c + c).join('') : value.slice(1);
  const [r, g, b, a = 1] = normalized.match(/../g).map((part) => parseInt(part, 16) / 255);
  return [r, g, b, a];
}
function over(front, back, opacity = 1) {
  const [r, g, b, opacityOfFront = 1] = rgb(front);
  const a = opacity * opacityOfFront;
  return rgb(back).slice(0, 3).map((v, i) => a * [r, g, b][i] + (1 - a) * v);
}
function linear(v) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function linearRgb(color) { return rgb(color).slice(0, 3).map(linear); }
function luminance(color) {
  const [r, g, b] = linearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground, base) {
  const x = luminance(over(foreground, base)), y = luminance(base);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// v2.8.0 getReadableThemeColors: quantize the sRGB backplate, then test the
// seed and, only if needed, move toward black or white to hit the 4.6 margin.
const quantize = (channels) => channels.slice(0, 3).map((v) => Math.round(v * 255) / 255);
function readableText(seed, base) {
  if (contrast(seed, base) >= 4.5) return seed;
  const endpoint = contrast('#ffffff', base) >= contrast('#000000', base) ? 1 : 0;
  const initial = rgb(seed).slice(0, 3);
  let low = 0, high = 1, best = [endpoint, endpoint, endpoint];
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    const candidate = quantize(initial.map((v) => v + mid * (endpoint - v)));
    if (contrast(candidate, base) >= 4.6) { high = mid; best = candidate; } else low = mid;
  }
  return best;
}
function runtimeTinted(seed, opacity, bases) {
  return bases.reduce((text, base) => readableText(text, quantize(over(seed, base, opacity))), seed);
}
function toLab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const lab = (color) => toLab(linearRgb(color));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));
const nearest = (list, metric) => list.reduce((a, b) => b[metric] < a[metric] ? b : a);

// Machado, Oliveira & Fernandes (2009), severity 1.0; multiply LINEAR sRGB
// first, then clamp the simulated display gamut before converting to OKLab.
const matrices = {
  protan: [
    [0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900],
  ],
};
function simulated(color, matrix) {
  const rgb = linearRgb(color);
  return toLab(matrix.map((row) => Math.min(1, Math.max(0, row.reduce((sum, v, i) => sum + v * rgb[i], 0)))));
}
function chromaHue(color) {
  const [, a, b] = lab(color);
  return [Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
function secondaryFamily(color) {
  const [c, h] = chromaHue(color);
  if (c < .020) return 'neutral';
  return h < 35 ? 'seal-red' : h < 66 ? 'coral-copper' : h < 101 ? 'reed-gold' : h < 126 ? 'citron'
    : h < 172 ? 'leaf' : h < 224 ? 'cyan' : h < 272 ? 'blue' : h < 325 ? 'violet' : 'burgundy';
}

const warmHue = (h) => h >= 345 || h < 112;
function visualFamily(value, mode, role) {
  const [L] = lab(value), [C, h] = chromaHue(value);
  if (role === 'canvas') {
    // A shadow and a gray panel can differ even with no hue. At near-white,
    // only count tint as color above the visible cast floor.
    if (mode === 'light' && C < .005) return L >= .990 ? 'white' : 'chalk';
    if (mode === 'dark' && C < .011) return L < .158 ? 'near-black'
      : C >= .0055 && warmHue(h) ? 'warm-charcoal' : 'charcoal';
  } else if (C < .019) return 'neutral';
  return h >= 344 || h < 36 ? 'red' : h < 73 ? 'orange' : h < 125 ? 'yellow'
    : h < 175 ? 'green' : h < 224 ? 'aqua' : h < 250 ? 'blue'
      : h < 284 ? 'indigo' : 'violet';
}

// The broad hue bins stay in force for every other slot. These authored slots
// can split a bin only within a narrow color band and with measured separation
// from every peer in that same broad bin.
const visualRefinements = new Map([
  ['theme-studio-afterglow-light', {
    canvas: { name: 'apricot-paper', l: [.970, .990], c: [.014, .015], h: [76, 82], separation: { sidebar: .085 } },
    bubble: { name: 'apricot-message', l: [.885, .905], c: [.060, .075], h: [55, 65], separation: { bubble: .075 } },
  }],
  ['theme-studio-hojicha-light', {
    canvas: { name: 'milk-cream', l: [.945, .973], c: [.020, .028], h: [82, 88], separation: { sidebar: .085 } },
  }],
  ['theme-studio-hojicha-dark', {
    selection: { name: 'deep-celadon', l: [.329, .353], c: [.035, .049], h: [182, 196],
      separation: { selection: .032, sidebar: .050 } },
  }],
]);
function visualFamilyWithContext(entry, peers, mode, role) {
  const { id, swatches } = entry;
  const value = swatches[role], broad = visualFamily(value, mode, role);
  const split = visualRefinements.get(id)?.[role];
  if (!split) return broad;
  const [L] = lab(value), [C, h] = chromaHue(value);
  const within = (v, [lo, hi]) => v >= lo && v <= hi;
  const inBand = within(L, split.l) && within(C, split.c) && within(h, split.h);
  check(inBand, `${id} ${role} 不在 ${split.name} 的 L/C/H 范围内`);
  if (!inBand) return broad;
  for (const peer of peers) {
    if (peer === entry || visualFamily(peer.swatches[role], mode, role) !== broad) continue;
    for (const [slot, floor] of Object.entries(split.separation)) {
      const d = distance(lab(swatches[slot]), lab(peer.swatches[slot]));
      check(d >= floor, `${id} ${role} 与 ${peer.id} 同属 ${broad}，${slot} ΔEOK ${f(d, 4)} < ${floor}`);
    }
  }
  return split.name;
}

function validateColors(c, id, hard, dusk) {
  keys(c, fields('primary surface interactive status pr syntax chat markdown tools'), `${id}.colors`);
  keys(c.primary, fields('base foreground hover active muted'), `${id}.primary`);
  keys(c.surface, [...fields('background foreground muted elevated subtle mutedForeground'), ...(hard || dusk ? ['overlay'] : [])], `${id}.surface`);
  keys(c.interactive, fields('border borderHover borderFocus focus focusRing selection selectionForeground hover active'), `${id}.interactive`);
  keys(c.status, statuses.flatMap((key) => ['', 'Foreground', 'Background', 'Border'].map((suffix) => key + suffix)), `${id}.status`);
  keys(c.pr, prRoles, `${id}.pr`);
  keys(c.syntax, fields('base tokens highlights'), `${id}.syntax`);
  keys(c.syntax.base, ['background', 'foreground', 'comment', ...syntaxRoles], `${id}.syntax.base`);
  keys(c.syntax.tokens, fields('punctuation variableProperty className stringEscape'), `${id}.syntax.tokens`);
  keys(c.syntax.highlights, [...diffRoles.flatMap((role) => [`diff${role}`, `diff${role}Background`]), 'lineNumber', 'lineNumberActive'], `${id}.syntax.highlights`);
  keys(c.chat, fields('userMessageBackground divider'), `${id}.chat`);
  keys(c.markdown, fields('link linkHover inlineCode inlineCodeBackground blockquote blockquoteBorder listMarker italic'), `${id}.markdown`);
  keys(c.tools, fields('border icon title description edit'), `${id}.tools`);
  keys(c.tools.edit, fields('addedBackground removedBackground modifiedBackground lineNumber'), `${id}.tools.edit`);
  const walk = (object, path) => {
    for (const [k, v] of Object.entries(object)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}.${k}`);
      else if (typeof v !== 'string' || !(hard ? solidLiteral : hexLiteral).test(v)) {
        throw new Error(`${path}.${k}：${hard ? '紫弧每个自定义颜色必须不透明' : '只接受 #RRGGBB 或 #RRGGBBAA'}`);
      }
    }
  };
  walk(c, id);
  const solids = [
    ...Object.entries(c.surface).filter(([role]) => role !== 'overlay').map(([, value]) => value),
    c.primary.base, c.primary.foreground, c.primary.hover, c.primary.active,
    c.interactive.selectionForeground, c.interactive.border,
    ...statuses.flatMap((key) => [c.status[key], c.status[`${key}Foreground`]]),
    ...Object.values(c.syntax.base), ...Object.values(c.syntax.tokens), ...Object.values(c.pr),
    c.chat.userMessageBackground, c.markdown.inlineCode, c.markdown.inlineCodeBackground,
  ];
  check(solids.every((v) => solidLiteral.test(v)), `${id}：画布或实际文字/按钮使用了透明基础色`);
}

function checkDuskUndertone({ metadata: { id, variant }, colors: c }, accentGap, hue) {
  const { surface: s, interactive: i } = c;
  const dark = variant === 'dark', lo = dark ? 293 : 296, hi = dark ? 297 : 300;
  // Per-role chroma ceilings from the previously approved palette, except the
  // explicitly lowered light elevated ceiling.
  const budget = [
    ['画布', s.background, .011, .018], ['侧栏', s.muted, .00691, .01607],
    ['浮层', s.elevated, .009, .01928], ['低强调面', s.subtle, .00850, .01955],
    ['代码面', c.syntax.base.background, .01936, .02037], ['选中', i.selection, .04113, .04977],
    ['边线', i.border, .01988, .02635], ['悬停边线', i.borderHover, .01895, .02312],
    ['引用线', c.markdown.blockquoteBorder, .03046, .03262],
  ];
  const failures = errors.length;
  for (const [role, value, lightMax, darkMax] of budget) {
    const [C, h] = chromaHue(value), max = dark ? darkMax : lightMax;
    check(solidLiteral.test(value) && h >= lo && h <= hi && C > .002 && C <= max,
      `${id} ${role} 未收至灰紫 ${lo}–${hi}° / C≤${max}：h=${f(h, 2)}°，C=${f(C, 5)}`);
  }
  check(c.chat.divider === i.border && c.tools.border === i.border, `${id} 分隔线与工具边线应与通用边线一致`);
  // The default scrim is achromatic, so the explicit hue gets only a near-black
  // RGB tint; same alpha and an almost unchanged effective L on the canvas.
  const [overlayC, overlayHue] = chromaHue(s.overlay);
  const overlayL = lab(s.overlay)[0];
  const before = lab(over('#00000099', s.background)), after = lab(over(s.overlay, s.background));
  const chromaLift = Math.hypot(...after.slice(1)) - Math.hypot(...before.slice(1));
  check(s.overlay.endsWith('99') && overlayHue >= lo && overlayHue <= hi && overlayC > 0 && overlayL <= .060
    && Math.abs(before[0] - after[0]) <= .004 && chromaLift <= .006, `${id} 遮罩应维持六成不透明的近黑灰紫`);
  check(accentGap >= .090 && hue >= 20, `${id} 靛紫强调未与低彩灰紫底拉开（ΔC=${f(accentGap)}，Δh=${f(hue, 1)}°）`);
  return errors.length === failures;
}

function evaluate(theme, design) {
  const { metadata: { id, variant }, colors: c } = theme;
  const { surface: s, interactive: i, primary: p, syntax: { base: b, tokens, highlights: h }, markdown: m } = c;
  const dark = variant === 'dark', oled = id === 'theme-studio-zero-hour-dark';
  const { layout, secondaryPr, secondaryMode, gamutException } = design;
  const hard = layout === 'hard', seam = layout === 'seam';
  const shared = [s.background, s.muted, s.elevated];
  const selected = over(i.selection, s.background); // .oc-selected always draws over canvas.
  const bubble = c.chat.userMessageBackground;
  const layers = {
    '画布': s.background, '侧栏': s.muted, '浮层': s.elevated, '低强调区': s.subtle,
    '选中会话': selected, '会话悬停': over(i.hover, s.muted, 0.6),
    '字段悬停': over(i.hover, s.elevated), '字段按下': over(i.active, s.elevated), '用户气泡': bubble,
  };
  const metrics = { id, variant, body: 0, secondary: Infinity, syntax: Infinity, comment: Infinity,
    markdown: Infinity, status: Infinity, button: Infinity, focus: Infinity, diffInk: Infinity, diffFill: Infinity,
    cvdStatus: Infinity, selectedSecondary: 0, selectedPr: 0, terminal: Infinity, terminalDim: Infinity };
  const atLeast = (label, foreground, background, floor = 4.5, key) => {
    const shown = contrast(foreground, background);
    check(shown >= floor, `${id} ${label}：${f(shown, 2)}:1 < ${floor}:1`);
    if (key) metrics[key] = Math.min(metrics[key], shown);
  };
  const between = (label, shown, low, high) => check(shown >= low && shown <= high,
    `${id} ${label}：${f(shown, 3)}:1 不在 ${low}–${high}:1`);
  const baseBody = contrast(s.foreground, s.background);
  metrics.body = baseBody;
  // Match built-in targets while avoiding unnecessarily harsh near-black copy.
  between('画布正文', baseBody, dark ? 15 : 13, dark ? 16.5 : 14.6);
  for (const [name, base] of Object.entries(layers)) {
    atLeast(`正文 @${name}`, name === '选中会话' ? i.selectionForeground : s.foreground, base, 7);
    // Detailed session lines source mutedForeground globally. There is no
    // special-case gate: the selected fill itself must preserve both kinds of copy.
    atLeast(`次要文字 @${name}`, s.mutedForeground, base, 4.5, 'secondary');
  }
  metrics.selectedSecondary = contrast(s.mutedForeground, selected);
  metrics.selectedPr = Math.min(...Object.values(c.pr).map((color) => contrast(color, selected)));
  // TerminalView uses the page paint: canvas normally, muted (or the
  // light-mode half blend) when docked.
  const dock = dark ? s.muted : quantize(over(s.muted, s.background, 0.5));
  for (const { name, ink, floor } of terminalInks(c)) {
    const key = name === 'brightBlack' ? 'terminalDim' : 'terminal';
    atLeast(`终端 ${name} @主区`, ink, s.background, floor, key);
    atLeast(`终端 ${name} @停靠`, ink, dock, floor, key);
  }
  const caps = { ...surfaceCaps[variant], ...gamutException?.surfaces };
  for (const [role, color] of Object.entries({ canvas: s.background, sidebar: s.muted, elevated: s.elevated })) {
    const [chroma] = chromaHue(color);
    check(chroma <= caps[role], `${id} ${role} 大面 C ${f(chroma, 4)} > ${caps[role]}`);
  }
  // Modes may put a lighter sidebar or card over the canvas, or make canvas
  // and rail the same plane and outsource the break to an authored seam.
  const railSeparation = contrast(s.muted, s.background);
  const cardSeparation = contrast(s.elevated, s.background);
  between('画布 / 侧栏', railSeparation, seam || hard ? 1 : 1.035, seam ? 1.026 : 1.50);
  between('画布 / 浮层', cardSeparation, dark ? 1.05 : 1.015, 1.48);
  if (layout === 'rail-lift') check(luminance(s.muted) > luminance(s.background), `${id} 侧栏应比画布亮`);
  if (layout === 'bright-card') check(luminance(s.elevated) > luminance(s.background), `${id} 浮层应比画布亮`);
  if (oled) check(s.background === '#000000', `${id} OLED 画布必须是纯黑`);

  if (dark) {
    // Recognizable warm surfaces require an assigned role limit. This
    // is separate from the limits on ink, diff/status and small selection marks.
    for (const [role, label, backplate] of [
      ['canvas', '画布', s.background], ['sidebar', '侧栏', s.muted], ['elevated', '浮层', s.elevated],
      ['subtle', '低强调区', s.subtle], ['code', '代码底', b.background], ['bubble', '气泡', bubble],
    ]) {
      const [C, h] = chromaHue(backplate);
      const cap = gamutException?.warm?.[role] ?? .016;
      check(!warmHue(h) || C <= cap, `${id} ${label} 深色暖底：C=${f(C, 3)} > ${cap}，h=${f(h, 1)}°`);
    }
  }
  between('代码 / 画布', contrast(b.background, s.background), 1, hard || seam ? 1.25 : 1.11);
  between('气泡 / 画布', contrast(bubble, s.background), 1.025, hard ? dark ? 2.75 : 1.90 : 1.32);
  between('选中会话 / 侧栏', contrast(selected, s.muted), 1.015, hard ? dark ? 2.65 : 1.85 : 1.62);
  check(distance(lab(selected), lab(s.muted)) >= (hard ? .10 : .028), `${id} 选中行与侧栏太近`);
  check(distance(lab(selected), lab(layers['会话悬停'])) >= .022, `${id} 选中行与悬停行太近`);
  between('悬停 / 侧栏', contrast(layers['会话悬停'], s.muted), 1.03, 1.24);
  for (const base of shared) {
    between('常规边线', contrast(i.border, base), hard ? 12 : seam ? 1.85 : 1.05, hard ? 21 : seam ? 3.50 : 1.95);
    between('悬停边线', contrast(i.borderHover, base), hard ? 12 : 1.12, hard ? 21 : seam ? 4.20 : 2.65);
    atLeast('焦点环', i.focusRing, base, hard ? 5.5 : 3, 'focus');
  }
  if (hard) {
    check(i.border === (dark ? '#ffffff' : '#000000'), `${id} 硬边要求浅版纯黑、深版纯白边线`);
    check(chromaHue(selected)[0] >= .11 && chromaHue(bubble)[0] >= (dark ? .065 : .12),
      `${id} 硬边的选中和气泡须是饱和实色块`);
    check(chromaHue(b.background)[0] <= .005 && (dark ? lab(b.background)[0] < .20 : lab(b.background)[0] > .97),
      `${id} 硬边文件面应是白／近黑，不把信号色铺满`);
    check(distance(lab(s.mutedForeground), lab(s.foreground)) <= .10, `${id} 硬边的正文与次要墨应接近`);
  }
  if (hard) {
    // The v2.8.0 thumb is global mutedForeground and cannot be black or
    // white independently of secondary text. Hard Edge communicates state
    // via the checked/unchecked track intensity as well as thumb position.
    atLeast('开关：关轨道 / 浮层', i.border, s.elevated, 3);
    atLeast('开关：开轨道 / 关轨道', p.base, i.border, 3);
    atLeast('开关：关滑块（位置提示）', s.mutedForeground, i.border, 1.5);
  } else {
    atLeast('开关：关（thumb / track）', s.mutedForeground, i.border, 3);
  }
  for (const state of ['base', 'hover', 'active']) {
    atLeast(`实心按钮/开关文字 ${state}`, p.foreground, p[state], 4.5, 'button');
  }
  const primaryOpacity = dark ? 0.30 : 0.22;
  const primaryText = runtimeTinted(p.base, primaryOpacity, [s.background, s.elevated, s.muted]);
  for (const base of shared) {
    atLeast('浅填色按钮文字', primaryText, over(p.base, base, primaryOpacity), 4.5, 'button');
  }

  const markdownBases = [...shared, s.subtle, bubble];
  for (const base of markdownBases) {
    for (const role of ['link', 'linkHover', 'blockquote', 'listMarker', 'italic']) {
      atLeast(`Markdown ${role}`, m[role], base, 4.5, 'markdown');
    }
    // v2.8.0's plain fallback and modern Streamdown chip: 50% fill, then 4% body tint.
    atLeast('行内代码（现代）', m.inlineCode, over(s.foreground, over(m.inlineCodeBackground, base, 0.5), 0.04), 4.5, 'markdown');
  }
  atLeast('行内代码（兼容）', m.inlineCode, m.inlineCodeBackground, 4.5, 'markdown');
  const [accentC, accentHue] = chromaHue(p.base);
  const [secondaryC, secondaryHue] = chromaHue(m.link);
  const [chipC, chipHue] = chromaHue(m.inlineCode);
  const [bubbleC, bubbleHue] = chromaHue(bubble);
  check(c.pr[secondaryPr] === m.link && distance(lab(p.base), lab(m.link)) >= .065, `${id} 第二色墨色须与主色拉开，并进入 PR`);
  if (accentC >= .035 && secondaryC >= .035) {
    check(hueGap(accentHue, secondaryHue) >= 34, `${id} 主色 / 第二色色相相距不足 34°`);
  }
  if (secondaryMode === 'ink' || secondaryMode === 'point') {
    check(chipC >= .033 && hueGap(chipHue, secondaryHue) <= 24
      && (secondaryMode === 'point' || (bubbleC >= .020 && hueGap(bubbleHue, secondaryHue) <= 24)),
      `${id} 气泡与行内代码未延续第二色（链接 ${f(secondaryHue, 1)}° / 气泡 ${f(bubbleHue, 1)}° / 行码 ${f(chipHue, 1)}°）`);
  }
  if (secondaryMode === 'annotation') {
    const [paperC, paperHue] = chromaHue(bubble);
    check(chipC >= .033 && hueGap(chipHue, secondaryHue) <= 24 && warmHue(secondaryHue)
      && paperC >= .018 && !warmHue(paperHue), `${id} 暖色只复用为注记墨，冷色气泡须与其分开`);
  }
  if (secondaryMode === 'wash') {
    const [fillC, fillHue] = chromaHue(m.inlineCodeBackground);
    check(variant === 'light' && secondaryC <= .028 && chipC <= .028 && bubbleC >= .031 && fillC >= .024
      && hueGap(bubbleHue, fillHue) <= 18, `${id} 底色色相须在气泡／行码底延续，且使用干净的近中性墨色`);
  }
  if (secondaryMode === 'neutral') {
    check(secondaryC < .025 && chipC < .025 && bubbleC < .025, `${id} 不应引入第二个彩色信号`);
  }
  if (!dark) {
    for (const [label, ink] of Object.entries({ link: m.link, inline: m.inlineCode, number: b.number, type: b.type })) {
      const [chroma, hue] = chromaHue(ink);
      check(chroma < .030 || hue < 71 || hue > 124, `${id} 浅版 ${label} 不以浊黄／橄榄作为文字`);
    }
  }
  const authoredAnchors = [p.base, m.link, m.inlineCode, bubble, selected];
  const cast = (value) => {
    const [L] = lab(value), [C, h] = chromaHue(value);
    return { L, C, h };
  };
  const anchors = authoredAnchors.map(cast);
  // Semantic success/merged roles are not decorative pairings.
  check(!(anchors.some(({ L,C,h }) => L < .425 && C > .027 && h >= 135 && h <= 181)
    && anchors.some(({ C,h }) => C > .033 && h >= 273 && h <= 327)), `${id} 不配深绿与紫`);
  for (const [base, label] of [[s.background, '画布'], [s.elevated, '浮层']]) {
    for (const role of ['icon', 'title', 'description']) atLeast(`工具卡片 ${role} @${label}`, c.tools[role], base);
  }

  const editBacks = [
    ['代码', b.background, diffRoles.map((role) => h[`diff${role}Background`])],
    ['工具/画布', s.background, diffRoles.map((role) => c.tools.edit[`${role.toLowerCase()}Background`])],
    ['工具/浮层', s.elevated, diffRoles.map((role) => c.tools.edit[`${role.toLowerCase()}Background`])],
  ];
  const testedCodeBacks = new Map([['文件代码', b.background], ['聊天代码围栏', s.elevated], ['编辑器当前行', s.muted],
    ['编辑器选中文本', over(i.selection, b.background)]]);
  for (const [label, base, overlays] of editBacks) {
    const backgrounds = overlays.map((overlay) => over(overlay, base));
    for (const [n, role] of diffRoles.entries()) {
      const name = `${label} ${role}`;
      atLeast(`${name} 标记`, h[`diff${role}`], backgrounds[n]);
      atLeast(`${name} 行号`, label === '代码' ? h.lineNumber : c.tools.edit.lineNumber, backgrounds[n]);
      atLeast(`${name} 文本`, b.foreground, backgrounds[n]);
      if (label === '代码') testedCodeBacks.set(name, backgrounds[n]);
    }
    for (const [vision, matrix] of Object.entries(matrices)) {
      const ink = Math.abs(simulated(h.diffAdded, matrix)[0] - simulated(h.diffRemoved, matrix)[0]);
      const fill = (simulated(backgrounds[0], matrix)[0] - simulated(backgrounds[1], matrix)[0]) * (dark ? 1 : -1);
      metrics.diffInk = Math.min(metrics.diffInk, ink);
      metrics.diffFill = Math.min(metrics.diffFill, fill);
      // Even at zero red/green discrimination keep a visible L gap in both
      // text and row wash, with the same lighter/darker order within each mode.
      check(ink >= 0.085, `${id} ${label} ${vision} diff 标记 ΔL ${f(ink)} < 0.085`);
      check(fill >= 0.040, `${id} ${label} ${vision} diff 底色 ΔL ${f(fill)} < 0.040`);
    }
  }
  for (const [where, base] of testedCodeBacks) {
    for (const [role, value] of Object.entries({ ...b, ...tokens, lineNumber: h.lineNumber, lineNumberActive: h.lineNumberActive })) {
      if (role === 'background') continue;
      const isComment = role === 'comment';
      atLeast(`${where} ${role}`, value, base, isComment ? 4 : 4.5, isComment ? 'comment' : 'syntax');
    }
  }

  const hueBands = { info: [195, 269], success: [128, 176], warning: [50, 105], error: [346, 43] };
  const statusBacks = [...shared, selected];
  for (const role of statuses) {
    const [chroma, hue] = chromaHue(c.status[role]);
    const [lo, hi] = hueBands[role];
    const meaningfulHue = lo < hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi;
    check(chroma >= 0.060 && meaningfulHue, `${id} ${role} 色相 ${f(hue, 1)}° / 色度 ${f(chroma)} 不合语义`);
    const fromPrimary = distance(lab(c.status[role]), lab(p.base));
    check(fromPrimary >= 0.065, `${id} ${role} 太接近主色：ΔEOK ${f(fromPrimary)} < 0.065`);
    atLeast(`${role} 反色文字`, c.status[`${role}Foreground`], c.status[role], 4.5, 'status');
    for (const base of statusBacks) {
      atLeast(`${role} 文字`, c.status[role], base, 4.5, 'status');
      atLeast(`${role} 提示底色文字`, c.status[role], over(c.status[`${role}Background`], base), 4.5, 'status');
    }
    const opacity = role === 'error' ? (dark ? 0.20 : 0.16) : 0.15;
    const derived = runtimeTinted(c.status[role], opacity, [s.background, s.elevated, s.muted]);
    for (const base of shared) atLeast(`${role} 对比修正按钮`, derived, over(c.status[role], base, opacity), 4.5, 'status');
  }
  for (const [a, b] of pairs(statuses)) {
    for (const [vision, matrix] of Object.entries(matrices)) {
      const d = distance(simulated(c.status[a], matrix), simulated(c.status[b], matrix));
      metrics.cvdStatus = Math.min(metrics.cvdStatus, d);
      check(d >= 0.070, `${id} ${vision} 状态 ${a}/${b} ΔEOK ${f(d)} < 0.070`);
    }
  }
  for (const role of prRoles) {
    for (const base of statusBacks) atLeast(`PR 标记 ${role}`, c.pr[role], base);
  }
  return metrics;
}

function fingerprint(theme) {
  const { metadata: { id, variant }, colors: c } = theme;
  const { surface: s } = c;
  const selection = c.interactive.selection ?? `#${rgb(s.foreground).slice(0,3).map((v) => Math.round(v * 255)
    .toString(16).padStart(2, '0')).join('')}29`; // v2.8.0 default opacity 0.16.
  return {
    id, variant,
    stamps: [c.primary.base, s.background, s.muted, ...syntaxRoles.map((r) => c.syntax.base[r]),
      s.elevated, c.markdown?.link ?? c.primary.base, c.chat?.userMessageBackground ?? s.elevated, selection, c.interactive.border],
  };
}
function pairDistance(a, b) {
  const coords = (x) => {
    const [primary, canvas, sidebar, ...rest] = x.stamps;
    const [elevated, secondary, bubble, selection, edge] = rest.slice(7);
    const key = (color) => lab(over(color, canvas));
    const L = (color) => key(color)[0];
    return {
      roles: [primary, secondary, bubble, selection].map(key),
      syntax: rest.slice(0, 7).map(key),
      edge: mean([canvas, sidebar, elevated].map((base) => Math.log(contrast(edge, base)))) / Math.log(21),
      structure: [(L(sidebar) - L(canvas)), (L(elevated) - L(canvas)), L(canvas) * .35],
    };
  };
  const x = coords(a), y = coords(b);
  const [primary, secondary, bubble, selection] = x.roles.map((v, i) => distance(v, y.roles[i]));
  const syntax = mean(x.syntax.map((v, i) => distance(v, y.syntax[i])));
  const edge = Math.abs(x.edge - y.edge);
  const structure = distance(x.structure, y.structure);
  // No minimum ΔE on large surface hues. Put the separation budget into
  // small author-controlled roles and silhouette; signed L offsets distinguish
  // lighter rails, mezzanines, and same-plane seams without rewarding dye.
  const score = .21 * primary + .18 * secondary + .12 * bubble + .13 * selection
    + .10 * edge + .18 * syntax + .08 * structure;
  const axes = [primary >= .060, secondary >= .060, bubble >= .040, selection >= .043,
    edge >= .050, syntax >= .060, structure >= .036].filter(Boolean).length;
  return { a: a.id, b: b.id, score, primary, secondary, bubble, selection, edge, syntax, structure, axes,
    variant: a.variant === b.variant ? a.variant : 'cross' };
}

// OpenChamber v2.8.0 tag. Compact source fingerprints, + original built-in IDs
// for error reporting; not re-exported as themes. With --upstream the complete
// JSON directory is read live, so a new built-in will enter the comparison.
const builtInCoreStamps = `
aura-dark dark a277ff 121117 0c0b11 a277ff 61ffca ff6767 82e2ff fdfdfd 61ffca c9c8ca
aura-light light 7557b7 f6f3fe f1eef9 7b5ae0 2b8a57 d94f4f 2f78b8 170e28 2b8a57 271f39
aurora-dark dark 239d6a 131515 090f0f 5cc692 e5a788 76b1e3 dcc99a ced2d2 82ccd7 939a9a
aurora-light light 063e2a fdfcfa f4f7f5 006e44 a94d1c 156ba6 786914 48423d 246e7e 67625f
ayu-dark dark 3fb7e3 0b1015 06090d ff8f40 aad94c d2a6ff ffb454 fbfbfc 59c2ff b3b7bc
ayu-light light 1b7793 fdfbf5 f8f6f1 c76a1a 6f8f00 a37acc b87500 2b3540 227fc0 3d4752
carbonfox-dark dark 33b1ff 292929 252525 be95ff 42be65 ff8389 33b1ff fefefe f1c21b ced0d3
carbonfox-light light 1159e3 eeeeee e9e9e9 8a3ffc 198038 da1e28 0f62fe 070707 8a5f00 151515
catppuccin-dark dark cba6f7 1e1e2e 181825 cba6f7 a6e3a1 fab387 89b4fa cdd6f4 f9e2af 94e2d5
catppuccin-light light 7130c7 eff1f5 e9ebef 8839ef 40a02b fe640b 1e66f5 4c4f69 df8e1d 179299
cursor-dark dark 4c9df3 1a1a1a 151515 83d6c5 e394dc ebc88d ebc88d 94C1FA efb080 d6d6dd
cursor-light light 2567A8 FCFCFC f6f6f6 126B63 894487 815C22 815C22 265F9E 965528 4A4E55
dracula-dark dark bd93f9 151720 12121b ff79c6 f1fa8c bd93f9 50fa7b fefefe fed7b1 d4d4ce
dracula-light light 6957d7 f9f9f4 f3f4ee d16090 596600 7c6bf5 2f8f57 0c0b1a 824a05 1b1b2b
everforest-dark dark a7c080 1c252b 1a2127 d699b6 a7c080 e69875 a7c080 e67e80 dbbc7f 83c092
everforest-light light 65740b fdf8e8 f7f3e4 df69ba 8da101 f57d26 8da101 f85552 dfa000 35a77c
fields-of-the-shire-dark dark 809062 1b1815 161311 5a6d7a 93a56b c47a3a c47a3a e9decf 7a8a5a a89888
fields-of-the-shire-light light 4a6030 f9f5eb f3efe5 3d4f5a 5e773f 8c5520 8c5520 514a40 4a6030 5a5048
flexoki-dark dark DA702C 171515 121111 4385BE 3AA99F 8B7EC8 DA702C dedcd3 D0A215 D14D41
flexoki-light light b54f14 fffdf4 f9f7ee 205EA6 24837B 5E409D BC5215 494741 AD8301 AF3029
github-dark dark 58a6ff 0a0e14 05070c ff7b72 39c5cf 58a6ff bc8cff d29922 d29922 ff7b72
github-light light 0f69d8 ffffff fafaf9 cf222e 0969da 1b7c83 8250df bc4c00 bc4c00 cf222e
gruvbox-dark dark 83a598 1f1e1d 1a1a1a fb4934 e6ea0d d3869b 83a598 fdfbf7 fdd995 c7b892
gruvbox-light light 12697a fcf5d7 f8f0d3 9d0006 605c10 8f3f71 076678 211d1b 7a4f0e 322e2c
jetbrains-dark dark 6796f5 1E1F22 18191b CF8E6D 6AAB73 2AACB8 6AA2D7 e5e7eb A6BB77 e5e7eb
jetbrains-light light 195ce3 FFF f9f9f9 0033B3 067D17 1750EB 00627A 45474b A04908 45474b
kanagawa-dark dark 7E9CD8 17161e 111119 957FB8 98BB6C D7A657 7E9CD8 DCD7BA C38D9D D27E99
kanagawa-light light 326384 f4ede3 efe8df 624c83 6f894e cc6d00 2D4F67 54433A b35b79 735896
material-dark dark 82aaff 1a252a 162126 c792ea c3e88d ffcb6b 82aaff eeffff ffcb6b 89ddff
material-light light 19787f fafafa f5f5f5 7c4dff 91b859 f4511e 6182b8 263238 ffb300 39adb5
mono-dark dark FFFFFF 000000 0A0A0A FFFFFF B3B3B3 999999 d0d0d0 CCCCCC D9D9D9 808080
mono-light light 000000 FFFFFF f9f9f9 000000 4D4D4D 666666 454545 333333 262626 808080
mono-plus-dark dark a2bee8 000000 0A0A0A dccdbeff b6d8e6ff e3bdadff a2bee8 cecece edcbb8ff dccdbeff
mono-plus-light light 4a6a9e FFFFFF f9f9f9 6a5a4a 4a6a7a 7a5a4a 4a6a9e 454545 6a5040 6a5a4a
monokai-dark dark ae81ff 1d1e19 191a15 f92672 e6db74 ae81ff a6e22e fefefe fcd7b7 d4d4ce
monokai-light light 8556b0 fdf9ef f8f4ea d9487c 8a6500 9b5fe0 3c8d2f 140e04 795011 241e13
nightowl-dark dark 82aaff 04101c 010a12 c792ea ecc48d f78c6c 82aaff fbfcfd fcce8f b4bac7
nightowl-light light 2c60d4 f1f1f1 ececeb 994cc3 136761 c96765 4876d6 232234 a61627 343346
nord-dark dark 88c0d0 1f2530 1c212c 81a1c1 b9f481 b48ead 88c0d0 fcfdfe ffd4c6 c2c5cb
nord-light light 426999 eef1f5 e9ecf1 5e81ac 6f8758 8d6886 5e81ac 141a26 953716 252b37
onedarkpro-dark dark 61AFEF 1E222A 181b22 61AFEF 98C379 E06C75 61AFEF e4ebf8 E5C07B E06C75
onedarkpro-light light 3c67bc F5F6F8 eff0f2 528BFF 4FA66D D85462 528BFF 454c58 D19A66 D85462
openchamber-dark dark da7c47 120f0e 0e0c0b 34983a d58373 279e93 78a952 c69457 479cb1 da6b6d
openchamber-light light b35017 fdfcfa f7f6f4 15764e c25f4b 177b8f 4e8b18 bb782a 0e8294 b94d50
opencode-dark dark 637ef8 161616 0a0a0a f799c6ff 96e3a6ff 93e9f6 f799c6ff EDEDED 9e99f7ff 707070
opencode-light light 3b5cf6ff ffffff fafafa c83d8bff 198b43ff 007b80 c83d8bff 171717 5230c2ff 6F6F6F
osaka-jade-refined dark 2dd5b7 0a1611 07100c 2DD5B7 63b07a D2689C 509475 C1C497 549e6a 459451
osaka-jade-refined-light light 197160 f1eee8 ebe9e3 1faa90 3d7a52 a8527a 3d7560 111c18 3d7a52 b5a020
patina-dark dark ca957a 141414 0c0c0c 72a371 c7998f 72a69f 92ad7f bda282 7ba5b1 cb8c8b
patina-light light 9d5939 faf9f6 f3f1ed 3c7357 a05d4f 3d7582 517936 926537 397682 a15757
rosepine-dark dark 9ccfd8 12101d 0c0b15 31748f f6c177 c4a7e7 ebbcba e0def4 9ccfd8 908caa
rosepine-light light 177394 fbf5ef f7f0eb 286983 ea9d34 907aa9 d7827e 575279 56949f 797593
solarized-dark dark 7e83cb 041d24 021820 859900 2aa198 d33682 268bd2 f6f8f8 ffda87 889595
solarized-light light 0a72b1 fdf8e8 f7f3e4 728600 1f8f88 d33682 268bd2 2e444b 70560f 41575e
tokyonight-dark dark 7aa2f7 13141e 0f0f18 bb9af7 a8fc1c ff9e64 7aa2f7 f9faff fdd8a5 a3abd2
tokyonight-light light 195fba e5e6ea e0e2e6 9854f1 436612 b15c00 1f6fd4 0f1638 77510a 1f284a
vercel-dark dark 0674f3 000000 000000 F75590 63C46D F2A700 BF7AF0 52A8FF 0AC7AC F75590
vercel-light light 0769e1 ffffff f9f9f9 E93D82 46A758 FFB224 8E4EC6 0070F3 12A594 E93D82
vesper-dark dark FFC799 0f0f0f 080808 a0a0a0 99ffe4 ffc799 ffc799 ffffff ffc799 dbdbdb
vesper-light light 8a5c35 f1f1f1 ebebeb 6e6e6e 117e69 8d541c 8d541c 040404 8d541c 101010
vitesse-dark-dark dark 4d9375 121212 0e0e0e 4d9375 c98a7d 4C9A91 80a665 bd976a 5d99a9 cb7676
vitesse-light-light light 1c6b48 ffffff f9f9f9 1e754f b56959 2f798a 59873a b07d48 2e808f ab5959
`.trim().split('\n');
// Same ordering as core stamps above; elevated, link, bubble, selection, border.
const builtInRoleStamps = `
1c1b21 a277ff 1f1a2e 47454bb6 ffffff0c
ede9f5 7355b4 e9e5f6 dfdce9 00000013
181b1b 7cafe8 082012a7 99a0a033 2b32326e
f0f3f1 1b69ad e4eee8 a59b902b e5e1debf
151a1f 3fb7e3 0e1f27 3c4147c9 ffffff0c
f5f4ed 1a748f ecefec e8eae3 00000013
2f2f2f 33b1ff 27343e 5b5c5b97 ffffff0b
e4e4e4 1158de dce1ea d5d5d5 00000013
181825 89b4fa 181825 313244 7f849c19
e5e7eb 1d62ed e2e0f1 ccd0da 66677023
232323 4c9df3 1e2a36 ffffff1d 8484841a
f2f2f2 2567A8 e6edf3 E1E1E1 5058601e
1c2029 bd93f9 231f32 4650559f ffffff0c
eeefe9 6755d4 ebebf0 dee1db 00000013
222c32 a7c080 242f2c 3e5151c5 ffffff0b
f5f2e2 626f0a efecd8 e9e8d5 00000013
24211e 75858f 28281e f0e6d81f 2e2b28d4
efebe2 3d4f5a e7e6d8 1a16121a 1a161215
201e1e 4d8cc1 312017 f4f4f41f 2b2a28d4
f5f3ea 205EA6 f5e9dd 76736f30 e6e4db
13171e 58a6ff 101b2b 373d44d8 ffffff0d
f5f5f4 0f69d8 edf2f9 e7e7e6 00000013
272623 83a598 252927 514d43b4 ffffff0b
f4eccf 12697a ebe9d0 e8dfc5 00000013
27282b 56A8F5 252d3f 43454A 303238b8
f5f5f5 006DCC e7edfb DFE1E5 dde0eadc
221e28 7E9CD8 1e212e 4f414ac7 ffffff0c
ede5db 326384 e4e1da e2dad0 00000013
212c31 82aaff 1f2e3c 4e5b6094 ffffff0b
f1f1f0 18757c eaeeee e3e3e2 00000013
141414 CCCCCC 1A1A1A ffffff1f 232323c6
f5f5f5 333333 E5E5E5 00000015 e3e3e3f2
141414 CCCCCC 0e1219 ffffff1f 232323c6
f5f5f5 333333 ebeef3 00000015 e3e3e3f2
252620 ae81ff 292531 53544e9a ffffff0b
f3efe5 8255ae f1ebe8 e5e0d6 00000013
0d1a26 82aaff 0d1c30 36424fc6 ffffff0d
e9e9e8 2b5dce e0e4ec dfdddb 00000013
262c37 88c0d0 232f3a 505661a3 ffffff0b
e5e8ed 406695 e0e4eb d8dce1 00000013
272b33 56B6C2 223141 a8aec533 3138489b
ebecee 40749f e1e7f4 d8dde6 d5d8dedb
1b1918 5d99a9 2d1c12 c8c6c52b 242323bf
f3f2f0 2d7d8c f3e9e3 26252120 e5e1debf
1f1f1f 6680f8 1c202f 3a3a3af6 ffffff0c
fafafa 3b5cf5 edf1fb eeeeeeff 00000013
121f18 2dd5b7 0b2b23 324235e1 ffffff0c
e7e4de 1a7261 e1e2dc d8d5d0 00000013
191919 84a3ac 271c16 d6d3cc24 2b2b2b99
f0eee9 457680 eee8e5 2a29261c d6d3cbb3
1c1a28 9ccfd8 1a1e29 444252c0 ffffff0c
f5ede7 167090 eae9e7 ece2db 00000013
0c242b 8185cd 122534 293f44 ffffff0c
f5f2e2 0a6eac ecece2 e6e8da 00000013
1b1d28 7aa2f7 1a1f32 3d4053d5 ffffff0c
dcdee3 195cb6 d5dae4 d0d2da 00000013
070707 137bf4 081221 2c2c2c ffffff12
f4f4f4 0768de ecf2f9 e4e4e4 00000013
191919 FFC799 211b16 484848a8 ffffff0c
e7e7e7 875b34 e7e3e1 d7d7d7 00000013
1b1b1b 4d9375 19241e eeeeee18 292929cd
f5f5f5 1e754f e9efec 22222218 e6e2e2f1
`.trim().split('\n');
const builtInSnapshot = builtInCoreStamps.map((line, index) => {
  const [id, variant, ...stamps] = line.split(' ');
  return { id, variant, stamps: [...stamps, ...builtInRoleStamps[index].split(' ')].map((value) => `#${value}`) };
});

const manifest = json(root, 'index.json');
keys(manifest, ['schemaVersion', 'presets'], 'index.json');
check(manifest.schemaVersion === 1, 'index.json：schemaVersion 必须为 1');
if (!Array.isArray(manifest.presets) || manifest.presets.length !== presetCount) throw new Error(`index.json：必须有 ${presetCount} 套配色`);
const all = [], ids = new Set(), slugs = new Set(), families = new Set(), files = new Set(['index.json']);
const brutalist = new Set(), exceptions = [], directions = new Set(), signatures = new Set(),
  syntaxStrategies = new Set(), layoutPairs = new Set(), hueRelations = [], designById = new Map(),
  secondFamilies = new Map(), bubblesByVariant = { light: [], dark: [] };
const visualRoles = ['canvas', 'bubble', 'selection'];
const visualThemes = Object.fromEntries(modes.map((mode) => [mode, []]));
const visualGroups = Object.fromEntries(modes.map((mode) =>
  [mode, Object.fromEntries(visualRoles.map((role) => [role, {}]))]));
const isText = (value) => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
for (const [index, preset] of manifest.presets.entries()) {
  keys(preset, fields('slug name description signature syntaxStrategy tags family rank style variants'), `index.json #${index + 1}`);
  const { slug, name, description, signature, syntaxStrategy, tags, family, rank, style, variants } = preset;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slugs.has(slug)) throw new Error(`index.json：无效或重复 slug ${slug}`);
  keys(name, ['zh', 'en'], `${slug}.name`);
  keys(description, ['zh', 'en'], `${slug}.description`);
  keys(signature, ['zh', 'en'], `${slug}.signature`);
  keys(syntaxStrategy, ['zh', 'en'], `${slug}.syntaxStrategy`);
  keys(variants, modes, `${slug}.variants`);
  check(rank === index + 1, `${slug} 推荐顺序错误`);
  check(isText(family) && !families.has(family), `${slug} 无独立色相家族`);
  check([name, description, signature, syntaxStrategy].every((entry) => isText(entry.zh) && isText(entry.en)
    && /\p{Script=Han}/u.test(entry.zh) && /[A-Za-z]/.test(entry.en)), `${slug} 中英文文案缺失`);
  if (!Array.isArray(tags) || !tags.length || !tags.every(isText)) throw new Error(`${slug} 无法读取标签`);
  keys(style, fields('direction label keywords fonts typography spacing motion'), `${slug}.style`);
  keys(style.fonts, ['sans', 'mono'], `${slug}.style.fonts`);
  keys(style.typography, fields('bodyPx codePx bodyWeight headingWeight lineHeight'), `${slug}.style.typography`);
  keys(style.spacing, fields('rhythmPx density'), `${slug}.style.spacing`);
  keys(style.motion, fields('tempo fastMs normalMs slowMs'), `${slug}.style.motion`);
  const cleanList = (xs, min) => Array.isArray(xs) && xs.length >= min && xs.every(isText) && new Set(xs).size === xs.length;
  const inRange = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
  const { bodyPx, codePx, bodyWeight, headingWeight, lineHeight } = style.typography;
  const { fastMs, normalMs, slowMs } = style.motion;
  const hard = style.direction === 'neo-brutalism';
  check(isText(style.direction) && !directions.has(style.direction) && isText(style.label) && cleanList(style.keywords, 2)
    && cleanList(style.fonts.sans, 3) && style.fonts.sans.at(-1) === 'sans-serif'
    && cleanList(style.fonts.mono, 3) && style.fonts.mono.at(-1) === 'monospace'
    && inRange(bodyPx, 12, 18) && inRange(codePx, 11, 16) && inRange(bodyWeight, 350, 650)
    && inRange(headingWeight, 550, 800) && bodyWeight <= headingWeight && inRange(lineHeight, 1.4, 1.9)
    && inRange(style.spacing.rhythmPx, 4, 16) && isText(style.spacing.density)
    && [fastMs, normalMs, slowMs].every((ms) => inRange(ms, 0, 1000)) && fastMs <= normalMs && normalMs <= slowMs
    && isText(style.motion.tempo), `${slug}：无效的风格建议`);
  slugs.add(slug);
  families.add(family);
  check(signature.zh.length >= 8 && !signatures.has(signature.zh), `${slug} 需要独有的、可读的设计签名`);
  check(syntaxStrategy.zh.length >= 8 && !syntaxStrategies.has(syntaxStrategy.zh), `${slug} 需要独有的语法策略`);
  directions.add(style.direction);
  signatures.add(signature.zh);
  syntaxStrategies.add(syntaxStrategy.zh);
  layoutPairs.add(`${variants.light.layout}/${variants.dark.layout}`);
  for (const variant of modes) {
    const file = `${slug}-${variant}.json`, id = `theme-studio-${slug}-${variant}`;
    const card = variants[variant];
    keys(card, ['file', 'id', 'swatches', 'layout', 'secondaryPr', 'secondaryMode',
      ...(card.surfaceException === undefined ? [] : ['surfaceException'])], `${slug}.${variant}`);
    check(layouts.includes(card.layout) && (card.layout === 'hard') === hard, `${slug}.${variant}：层级策略无效`);
    check(prRoles.includes(card.secondaryPr), `${slug}.${variant}：第二色没有有效 PR 角色`);
    check(['ink', 'wash', 'point', 'neutral', 'annotation'].includes(card.secondaryMode), `${slug}.${variant}：第二色着色方式未知`);
    const allowedException = surfaceExceptions.get(slug)?.[variant];
    const validException = card.surfaceException === allowedException?.tag;
    check(validException, `${slug}.${variant}：大面例外应为 ${allowedException?.tag ?? '无'}`);
    const gamutException = validException ? allowedException : undefined;
    if (gamutException) exceptions.push({ slug, id });
    if (file !== card.file || id !== card.id || ids.has(id)) throw new Error(`${slug}${variant} manifest 文件或 ID 不匹配`);
    const theme = json(root, file);
    keys(theme, ['metadata', 'colors'], file);
    keys(theme.metadata, fields('id name description variant version author tags'), `${file}.metadata`);
    const { metadata, colors: c } = theme;
    check(metadata.id === id && metadata.variant === variant
      && metadata.name === `${name.zh} · ${name.en}`
      && metadata.description === `${description.zh} ${description.en}`
      && /^\d+\.\d+\.\d+$/.test(metadata.version) && isText(metadata.author)
      && JSON.stringify(metadata.tags) === JSON.stringify([...tags, variant]), `${file} metadata 不匹配`);
    validateColors(c, id, hard, slug === 'dusk-margin');
    const swatches = cardSwatches(c);
    deepEqual(card.swatches, swatches, `${file} 缩略色板过期`);
    visualThemes[variant].push({ id, slug, swatches });
    const second = secondaryFamily(card.secondaryMode === 'wash' ? c.chat.userMessageBackground : c.markdown.link);
    if (!secondFamilies.has(second)) secondFamilies.set(second, new Set());
    secondFamilies.get(second).add(slug);
    bubblesByVariant[variant].push(lab(c.chat.userMessageBackground));
    if (family === 'neutral') {
      check([...Object.values(c.surface), ...Object.entries(c.syntax.base).filter(([role]) => role !== 'function').map(([, value]) => value), ...Object.values(c.primary),
        ...Object.values(c.interactive), c.chat.userMessageBackground, c.markdown.inlineCodeBackground]
        .every((color) => new Set(rgb(color).slice(0, 3)).size === 1), `${file} 中性结构或语法出现色偏`);
      check(card.secondaryMode === 'point' && chromaHue(c.syntax.base.function)[0] >= .040
        && hueGap(chromaHue(c.syntax.base.function)[1], chromaHue(c.markdown.link)[1]) <= 15, `${file} 只用同一家钢蓝突出调用`);
    }
    ids.add(id);
    if (hard) brutalist.add(id);
    files.add(file);
    all.push(theme);
    designById.set(id, { ...card, gamutException });
  }
  const finalists = all.slice(-2);
  const accentToBase = finalists.map((theme) => {
    const c = theme.colors;
    const [accentC, accentHue] = chromaHue(c.primary.base);
    const [tintC, tintHue] = [c.surface.background, c.surface.muted, c.surface.elevated].map(chromaHue).sort((a,b) => b[0]-a[0])[0];
    const gap = hueGap(accentHue, tintHue);
    return { accentC, tintC, gap, separated: accentC >= .040 && tintC >= .005 && gap >= 34,
      ...(slug === 'dusk-margin' ? { alignedUndertone: checkDuskUndertone(theme, accentC - tintC, gap) } : {}) };
  });
  hueRelations.push({ slug, light: accentToBase[0], dark: accentToBase[1] });
  if (family !== 'neutral') {
    const [first, second] = finalists.map(({ colors: c }, index) =>
      chromaHue(family === 'terminal' && index === 0 ? c.markdown.link : c.primary.base)[1]);
    const terminalSignal = chromaHue(finalists[0].colors.interactive.selection)[1];
    check(hueGap(family === 'terminal' ? terminalSignal : first, second) <= 54, `${slug} 浅深版失去辨识锚点`);
  }
}
check(brutalist.size === 2, '恰有一对新粗野主义主题');
check(layoutPairs.size >= 7, '至少保留七种不同的浅深层级组合');
const exceptionFamilies = new Set(exceptions.map(({ slug }) => slug));
check(exceptionFamilies.size === surfaceExceptions.size && exceptions.length === surfaceExceptions.size * modes.length,
  '大面例外只限蓝刻、晚照、焙茶各自的浅深两版');
const hueSeparated = hueRelations.filter(({ light, dark }) => light.separated && dark.separated);
const undertoneSeparated = hueRelations.filter(({ light, dark }) => light.alignedUndertone && dark.alignedUndertone);
// Dusk intentionally aligns all large planes. It must earn this one slot with
// a verified chroma gap instead; all other pairs still use the original 34° rule.
const separated = new Set([...hueSeparated, ...undertoneSeparated].map(({ slug }) => slug));
check(separated.size >= 6, `强调与底色双模式分离仅 ${separated.size}/${presetCount}；至少 6 套`);
for (const [family, dishes] of secondFamilies) check(dishes.size <= 2, `第二色家族 ${family} 聚集 ${dishes.size} 套：${[...dishes].join('、')}`);
for (const mode of modes) for (const role of visualRoles) {
  for (const entry of visualThemes[mode]) {
    const family = visualFamilyWithContext(entry, visualThemes[mode], mode, role);
    (visualGroups[mode][role][family] ??= []).push(entry.slug);
  }
  for (const [family, members] of Object.entries(visualGroups[mode][role])) {
    check(members.length <= 2, `${mode} ${role} 家族 ${family} 有 ${members.length} 套：${members.join('、')}`);
  }
}
const spread = (values) => Math.max(...values) - Math.min(...values);
for (const [mode, bubbles] of Object.entries(bubblesByVariant)) {
  check(spread(bubbles.map(([l]) => l)) >= .065 && spread(bubbles.map(([,a,b]) => Math.hypot(a,b))) >= .060,
    `${mode} 气泡明度／彩度没有高低`);
}
deepEqual(readdirSync(root).filter((name) => name.endsWith('.json')).sort(), [...files].sort(), '主题目录有缺失或游离 JSON');
if (flags.sheet) {
  const html = readFileSync(new URL('../docs/presets-sheet.html', import.meta.url), 'utf8');
  const block = /<script id="preset-data" type="application\/json">\n([\s\S]*?)\n  <\/script>/.exec(html);
  if (!block) throw new Error('图册没有可验证的内嵌主题数据');
  const embedded = JSON.parse(block[1]);
  deepEqual(embedded.presets, manifest.presets.map(({ slug, name, description, signature, syntaxStrategy, rank, style, variants }) =>
    ({ slug, name, description, signature, syntaxStrategy, rank, style: { label: style.label }, variants })), '图册索引未与 manifest 同步');
  deepEqual(Object.keys(embedded.compiled).sort(), [...ids].sort(), '图册内嵌版数错误');
  for (const item of manifest.presets) {
    for (const { id, file, swatches } of Object.values(item.variants)) {
      const hash = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
      const { sha256, css } = embedded.compiled[id];
      check(hash === sha256, `${id} 图册内嵌变量已过期`);
      check(typeof css === 'string' && css.includes(`--surface-background:${swatches.canvas};`)
        && css.includes(`--primary-base:${swatches.primary};`), `${id} 图册缺少核心渲染变量`);
    }
  }
}

const metrics = all.map((theme) => evaluate(theme, designById.get(theme.metadata.id))), fps = all.map(fingerprint);
const inHouse = pairs(fps).map(([a, b]) => pairDistance(a, b));
const sameMode = inHouse.filter((p) => p.variant !== 'cross');
for (const p of inHouse) {
  const name = `${p.a} ↔ ${p.b}`;
  check(p.score >= 0.058, `${name} 综合距离 ${f(p.score)} < 0.058`);
  if (p.variant !== 'cross') check(p.axes >= 3, `${name} 仅 ${p.axes} 处可见关系拉开`);
}
const upstreamStamps = flags.upstream
  ? readdirSync(flags.upstream).filter((name) => name.endsWith('.json')).sort().map((name) => fingerprint(json(flags.upstream, name)))
  : builtInSnapshot;
if (upstreamStamps.length < 62 || upstreamStamps.some((stamp) => !modes.includes(stamp.variant)
  || stamp.stamps.length !== 15 || !stamp.stamps.every((v) => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)))) {
  throw new Error('内置对照库版本不全或无法读出有效 swatch（至少应含 v2.8.0 的 62 个）');
}
const upstreamComparable = new Map(upstreamStamps.map((fp) => [fp.id, fp]));
const snapshotMatch = upstreamStamps.length === builtInSnapshot.length
  && builtInSnapshot.every(({ id, variant, stamps }) => {
    const candidate = upstreamComparable.get(id);
    return candidate?.variant === variant && candidate.stamps.join(' ') === stamps.join(' ');
  });
const comparisons = fps.flatMap((a) => upstreamStamps.map((b) => pairDistance(a, b)));
for (const p of comparisons) {
  check(p.a !== p.b, `${p.a} 与内置主题 ID 冲突`);
  check(p.score >= 0.050, `${p.a} 太像内置 ${p.b}：综合距离 ${f(p.score)} < 0.050`);
}
const worst = Object.fromEntries(
  Object.keys(metrics[0]).filter((x) => !['id', 'variant'].includes(x)).map((k) => [k, nearest(metrics, k)]),
);
const nearestSameMode = Object.fromEntries(fps.map(({ id }) => [id, {
  preset: nearest(sameMode.filter(({ a, b }) => a === id || b === id), 'score'),
  builtin: nearest(comparisons.filter(({ a, variant }) => a === id && variant !== 'cross'), 'score'),
}]));
const stats = {
  variantCount: all.length, pairCount: inHouse.length, sameModeCount: sameMode.length,
  builtInCount: upstreamStamps.length, comparisonCount: comparisons.length, snapshotMatch,
  terminalPairCount: all.reduce((count, theme) => count + terminalInks(theme.colors).length * 2, 0),
  nearestPair: nearest(inHouse, 'score'), nearestBuiltIn: nearest(comparisons, 'score'),
  minimumSameModeAxes: nearest(sameMode, 'axes').axes,
  worst, metrics, hueSeparated: hueSeparated.map(({slug}) => slug), undertoneSeparated: undertoneSeparated.map(({slug}) => slug),
  hueRelations, exceptions, visualGroups, nearestSameMode,
  secondFamilies: Object.fromEntries([...secondFamilies].map(([family, ids]) => [family, [...ids]])), errors,
};
if (flags.json) console.log(JSON.stringify(stats, null, 2));
else {
  const latest = flags.upstream ? `上游实读${snapshotMatch ? '，与 v2.8.0 指纹一致' : ''}` : '离线 v2.8.0 指纹';
  const label = (p) => `${p.a.replace('theme-studio-', '')} ↔ ${p.b.replace('theme-studio-', '')}`;
  const lowest = (key, precision = 2) => `${f(worst[key][key], precision)}（${worst[key].id.replace('theme-studio-', '')}）`;
  const byMode = (variant) => f(nearest(metrics.filter((x) => x.variant === variant), 'body').body, 2);
  console.log(`${errors.length ? 'FAIL' : 'PASS'} · ${presetCount} 套 / ${stats.variantCount} 个主题；${stats.pairCount} 组两两比较（同模式 ${stats.sameModeCount}）；${stats.builtInCount} 个内置 · ${stats.comparisonCount} 组对照（${latest}）`);
  console.log(`对比度最小值｜正文 浅 ${byMode('light')} / 深 ${byMode('dark')}；次要 ${lowest('secondary')}；Markdown ${lowest('markdown')}；语法 ${lowest('syntax')}；注释 ${lowest('comment')}`);
  console.log(`对比度最小值｜状态 ${lowest('status')}；按钮 ${lowest('button')}；焦点 ${lowest('focus')}`);
  console.log(`大面 C 受限｜强调 / 底色分离 ${separated.size}/${presetCount}（色相 ${hueSeparated.length}，灰紫底彩度 ${undertoneSeparated.length}）；层级组合 ${layoutPairs.size}；大面例外 ${exceptionFamilies.size} 套；第二色 ${secondFamilies.size} 家族`);
  console.log(`同模式家族上限 2｜${modes.map((mode) => `${mode} ${visualRoles.map((role) =>
    Math.max(...Object.values(visualGroups[mode][role]).map((members) => members.length))).join('/')}`).join('；')}（画布／气泡／选中）`);
  console.log(`最近自家 ${f(stats.nearestPair.score)}（${label(stats.nearestPair)}）；最近内置 ${f(stats.nearestBuiltIn.score)}（${label(stats.nearestBuiltIn)}，相似指数 ${f(1 - stats.nearestBuiltIn.score)} / 上限 0.950）；同模式至少 ${stats.minimumSameModeAxes} 处可见差别`);
  console.log(`色觉缺陷模拟最小值｜状态 ΔEOK ${lowest('cvdStatus', 3)}；diff 标记 ΔL ${lowest('diffInk', 3)}、底色 ΔL ${lowest('diffFill', 3)}`);
  console.log(`详细选中行最低｜分支／时间 ${lowest('selectedSecondary')}；PR ${lowest('selectedPr')}（全部纳入）`);
  console.log(`终端 ${stats.terminalPairCount} 组｜常规字 ${lowest('terminal', 3)}；brightBlack ${lowest('terminalDim', 3)}`);
  if (flags.sheet && !errors.length) console.log(`离线图册：${stats.variantCount} 个源文件 SHA-256 与索引一致`);
  if (errors.length) {
    console.error(`未通过 ${errors.length} 项：`);
    for (const error of errors) console.error(`- ${error}`);
  }
}
if (errors.length) process.exitCode = 1;
