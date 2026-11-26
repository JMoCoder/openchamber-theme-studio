import catalog from '../data/fields.json' with { type: 'json' };
import { parseTheme, withOpacity, readableText } from './theme-core.mjs';
import { angleGap, chromaDelta, delta, fit, fromLch, hex, lab, lch, over, ratio, redGreenDistance, rgb, swatch, under } from './theme-derive-color.mjs';

export const FIELDS = new Map(catalog.fields.map((field) => [field.path, { ...field, parts: field.path.split('.') }]));
export const LIVE_COLORS = [...FIELDS.values()].filter((field) => field.type === 'color' && field.effect.kind !== 'dead');
export const BASE_SYNTAX = ['comment', 'keyword', 'string', 'number', 'function', 'variable', 'type', 'operator'];
export const STATUS = {
  error: [25, 41], warning: [82, 27], success: [151, 35], info: [246, 36],
};
const leaves = new Set(FIELDS.keys());
const branches = new Set([...FIELDS.values()].flatMap(({ parts }) => parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'))));
const prefix = (short) => `colors.${short}`;

export function get(object, path) {
  const parts = FIELDS.get(path)?.parts ?? path.split('.');
  for (const key of parts) object = object != null && Object.hasOwn(object, key) ? object[key] : undefined;
  return object;
}

export function edit(definition) {
  const draft = structuredClone(definition), changes = new Map();
  return {
    draft,
    set(path, to, reason) {
      const field = FIELDS.get(path);
      if (!field || (field.effect.kind === 'dead')) return;
      const from = get(definition, path);
      if (get(draft, path) === to) return;
      let object = draft;
      for (const key of field.parts.slice(0, -1)) object = object[key] ??= {};
      if (to === undefined) delete object[field.parts.at(-1)];
      else object[field.parts.at(-1)] = to;
      if (from === to) changes.delete(path);
      else changes.set(path, { path, from, to, reason });
    },
    result() { return changes.size ? { definition: draft, changes: [...changes.values()] } : { definition, changes: [] }; },
  };
}

const fallbacks = {
  'chat.userMessageBackground': (c) => c.surface.elevated,
  'chat.divider': (c) => c.interactive.border,
  'markdown.link': (c) => c.primary.base,
  'markdown.linkHover': (c) => c.primary.hover,
  'markdown.inlineCode': (c) => c.syntax.base.string,
  'markdown.inlineCodeBackground': (c) => c.chat?.background ?? c.surface.background,
  'markdown.blockquote': (c) => c.surface.mutedForeground,
  'markdown.blockquoteBorder': (c) => c.interactive.border,
  'markdown.bold': (c) => c.surface.foreground,
  'markdown.italic': (c) => withOpacity(c.surface.foreground, 0.9),
  'markdown.strikethrough': (c) => c.surface.mutedForeground,
  'markdown.hr': (c) => c.interactive.border,
  'tools.border': (c) => withOpacity(c.interactive.border, 0.3),
  'tools.title': (c) => c.surface.foreground,
  'tools.icon': (c) => c.surface.mutedForeground,
  'tools.description': (c) => withOpacity(c.surface.mutedForeground, 0.6),
  'tools.edit.lineNumber': (c) => withOpacity(c.surface.mutedForeground, 0.6),
  'tools.edit.addedBackground': (c) => c.status.successBackground,
  'tools.edit.removedBackground': (c) => c.status.errorBackground,
};
export const EFFECTIVE_FILLS = {
  canvas: 'surface.background',
  muted: 'surface.muted', elevated: 'surface.elevated', subtle: 'surface.subtle',
  code: 'syntax.base.background', bubble: 'chat.userMessageBackground', inline: 'markdown.inlineCodeBackground',
  hover: 'interactive.hover', active: 'interactive.active', selection: 'interactive.selection',
  primary: 'primary.base', error: 'status.error', info: 'status.info',
  // DiffPreview uses the tool colours independently of TextMate's metadata.
  toolAdded: 'tools.edit.addedBackground', toolRemoved: 'tools.edit.removedBackground',
  textMateAdded: 'syntax.highlights.diffAddedBackground', textMateRemoved: 'syntax.highlights.diffRemovedBackground',
  ...Object.fromEntries(Object.keys(STATUS).map((key) => [`${key}Tag`, `status.${key}Background`])),
};
// .oc-selected always paints over the chat canvas; bg-interactive-selection
// can also be used over a sidebar or menu/card. Only text-foreground inherits
// the selected ink. Muted labels and state markers keep their normal colours.
const SELECTION_BASES = { selection: 'canvas', selectedSidebar: 'muted', selectedCard: 'elevated', selectedCode: 'code' };
const SELECTED_ROWS = ['selection', 'selectedSidebar', 'selectedCard'];
const INLINE_BASES = { inlineChat: 'canvas', inlineBubble: 'bubble' };

export function view(definition, parsed = parseTheme(definition)) {
  const colors = new Map(), backdrops = new Map(), { variant } = parsed.metadata;
  const value = (path) => get(parsed, prefix(path)) ?? fallbacks[path]?.(parsed.colors);
  const color = (path) => {
    if (!colors.has(path)) colors.set(path, rgb(value(path)));
    return colors.get(path);
  };
  const canvas = color(EFFECTIVE_FILLS.canvas);
  const effectiveCanvas = canvas ? over(canvas, under(variant)) : null;
  const back = (name) => {
    if (name === 'canvas') return effectiveCanvas;
    if (!backdrops.has(name)) {
      if (Object.hasOwn(INLINE_BASES, name)) {
        const base = back(INLINE_BASES[name]), chip = color(EFFECTIVE_FILLS.inline), ink = color('surface.foreground');
        // index.css: the Streamdown fill is applied at half alpha, with 4%
        // prose ink over it. Also check the undiluted theme value separately
        // for consumers which don't use that Markdown rule.
        const fill = base && chip && ink ? over({ ...ink, a: ink.a * 0.04 }, over({ ...chip, a: chip.a * 0.5 }, base)) : null;
        backdrops.set(name, fill);
        return fill;
      }
      const base = Object.hasOwn(SELECTION_BASES, name) ? back(SELECTION_BASES[name]) : effectiveCanvas;
      const front = color(Object.hasOwn(SELECTION_BASES, name) ? EFFECTIVE_FILLS.selection : EFFECTIVE_FILLS[name]);
      backdrops.set(name, front && (front.a === 1 ? front : base ? over(front, base) : null));
    }
    return backdrops.get(name);
  };
  return { definition, parsed, variant, dark: variant === 'dark', canvas: effectiveCanvas, value, color, back };
}

function text(path, surfaces, minimum = 4.5) { return { path, surfaces, minimum, code: 'contrast' }; }
function boundary(path, surfaces, minimum = 3) { return { path, surfaces, minimum, code: 'boundary' }; }
const surfaces = ['canvas', 'muted', 'elevated'];
export const EDGE_RULES = [
  boundary('interactive.border', surfaces),
  boundary('interactive.focusRing', [...surfaces, 'code']),
  boundary('interactive.selection', ['canvas', 'code'], 1.24),
  boundary('primary.base', surfaces),
  ...Object.keys(STATUS).map((key) => boundary(`status.${key}`, surfaces)),
  ...['diffAdded', 'diffRemoved', 'diffModified'].map((key) => boundary(`syntax.highlights.${key}`, ['code'])),
];
const TEXT_RULES = [
  text('surface.foreground', ['canvas', 'muted', 'subtle', 'bubble', 'hover', 'active', 'toolAdded', 'toolRemoved']),
  text('surface.mutedForeground', [...surfaces, 'subtle', 'toolAdded', 'toolRemoved']),
  text('surface.elevatedForeground', ['elevated']), text('primary.foreground', ['primary']),
  text('interactive.selectionForeground', [...SELECTED_ROWS, 'selectedCode']), text('status.errorForeground', ['error']),
  text('status.infoForeground', ['info']),
  text('syntax.base.foreground', ['code', 'textMateAdded', 'textMateRemoved']),
  ...BASE_SYNTAX.map((key) => text(`syntax.base.${key}`, ['code'])),
  text('syntax.highlights.lineNumber', ['code']), text('syntax.highlights.lineNumberActive', ['code']),
  ...LIVE_COLORS.filter(({ path }) => path.startsWith('colors.syntax.tokens.')).map(({ path }) => text(path.slice(7), ['code'])),
  ...['link', 'linkHover', 'blockquote', 'bold', 'italic', 'strikethrough'].map((key) => text(`markdown.${key}`, ['canvas', 'bubble'])),
  text('markdown.inlineCode', ['inline', ...Object.keys(INLINE_BASES)]),
  text('tools.title', ['elevated']), text('tools.description', ['elevated']), boundary('tools.icon', ['elevated']),
  text('tools.edit.lineNumber', ['toolAdded', 'toolRemoved', 'canvas']),
  ...['open', 'draft', 'blocked', 'merged', 'closed'].map((key) => boundary(`pr.${key}`, ['canvas', 'elevated'])),
];
const LAYERS = [
  { path: 'surface.muted', against: ['canvas'] }, { path: 'surface.elevated', against: ['canvas', 'muted'] },
  { path: 'surface.subtle', against: ['canvas'] }, { path: 'chat.userMessageBackground', against: ['canvas'] },
];
const ROW_RULES = [
  text('surface.mutedForeground', SELECTED_ROWS),
  ...Object.keys(STATUS).map((key) => boundary(`status.${key}`, SELECTED_ROWS)),
  ...['open', 'draft', 'blocked', 'merged', 'closed'].map((key) => boundary(`pr.${key}`, SELECTED_ROWS)),
];
const SYNTAX_PAIRS = [['keyword', 'string'], ['keyword', 'function'], ['string', 'number'], ['function', 'type'], ['comment', 'keyword'], ['number', 'type']];
export const SYNTAX_DELTA = 0.052;
export const syntaxPairs = (model) => SYNTAX_PAIRS.map(([a, b]) => {
  const first = model.color(`syntax.base.${a}`), second = model.color(`syntax.base.${b}`), bg = model.back('code');
  return { a, b, actual: first && second && bg ? delta(lab(over(first, bg)), lab(over(second, bg))) : null };
});

const labels = {
  contrast: ['字和底的反差', 'Text contrast'],
  boundary: ['边线、强调或选区与周围的反差', 'Edge, accent, or selection contrast'],
  'selected-row-contrast': ['选中会话或菜单项时，这个颜色不会跟着换，反差不足会看不清', 'This colour stays the same in a selected session or menu row and needs enough contrast against it'],
  layer: ['这两层背景不容易分清', 'These surfaces are hard to tell apart'],
  'soft-border': ['这处宿主会淡化边线，颜色够深也不一定清楚', 'The host fades some borders, even when the full-strength colour passes'],
  'status-hue': ['颜色不像这类状态，容易看错', 'The colour does not read as this status'],
  'status-accent': ['与主题强调色太像，容易把状态看成普通高亮', 'Too close to the theme accent to read as a distinct status'],
  'syntax-separation': ['这两个代码角色的颜色太像', 'These two syntax roles look too similar'],
  'diff-cvd': ['红绿色弱模拟下，新增和删除接近；保留 + / − 或文字标记', 'Add/remove look similar in red–green simulations; keep +/− or text labels'],
  'unknown-key': ['宿主不会读取此字段；导入时请核对清理提示', 'The host ignores this key; review import warnings'],
  'unused-field': ['此版本没有显示这个设置', 'This field has no visible effect in this version'],
  'not-computable': ['宿主数值计算不认这种写法；建议改用 HEX', 'Not supported by the host’s numerical colour routines; use HEX'],
  'hex-only': ['侧栏的 RGB 通道只读 HEX；其他位置仍可能正常显示', 'Sidebar RGB channels require HEX; other surfaces may still render'],
  'alpha-dropped': ['宿主侧栏提取 RGB 时会忽略透明度', 'The sidebar’s RGB extraction drops alpha'],
  'invalid-field': ['不符合原生主题格式', 'Not valid in a native theme definition'],
};
const message = (code, path, against) => {
  const [zh, en] = labels[code];
  const name = (key, locale) => FIELDS.get(key)?.label[locale] ?? key;
  return {
    zh: `${name(path, 'zh')}${against ? ` / ${name(against, 'zh')}` : ''}：${zh}。`,
    en: `${name(path, 'en')}${against ? ` / ${name(against, 'en')}` : ''}: ${en}.`,
  };
};
const rounded = (n) => typeof n === 'number' ? Number(n.toFixed(4)) : n;
function entry(code, path, { actual, minimum = null, pass = null, against, value, severity, threshold, ...extra }) {
  return { code, path, ...(against ? { against } : {}), value, actual: rounded(actual), minimum, pass,
    ...(threshold ? { threshold } : {}), severity: severity ?? (pass === false ? 'warning' : 'info'), message: message(code, path, against), ...extra };
}

function diagnostics(definition) {
  const found = [];
  function walk(obj, parent = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [name, value] of Object.entries(obj)) {
      const path = parent ? `${parent}.${name}` : name;
      // A literal dot in a syntax key is not a dotted path in the JSON.
      if (name.includes('.') || (!leaves.has(path) && !branches.has(path))) {
        found.push(entry('unknown-key', path, { actual: 'unknown', value, pass: false })); continue;
      }
      if (branches.has(path)) { walk(value, path); continue; }
      const field = FIELDS.get(path);
      if (field.effect.kind === 'dead' && !path.startsWith('metadata.')) {
        found.push(entry('unused-field', path, { actual: 'not-rendered', value, pass: false, severity: 'info' }));
      } else if (field.type === 'color') {
        const color = rgb(value);
        if (!color) found.push(entry('not-computable', path, { actual: typeof value === 'string' ? value : null, value, pass: false, threshold: 'HEX or numeric RGB(A)' }));
        else if (['colors.surface.muted', 'colors.surface.subtle', 'colors.interactive.border'].includes(path)) {
          if (!value.trim().startsWith('#')) found.push(entry('hex-only', path, { actual: value, value, pass: false, threshold: 'HEX' }));
          if (color.a < 1) found.push(entry('alpha-dropped', path, { actual: color.a, value, pass: false, severity: 'info', threshold: 'opaque HEX' }));
        }
      }
    }
  }
  walk(definition);
  return found;
}

function statusDistance(first, second) {
  if (!first || !second) return null;
  return chromaDelta(lab(first), lab(second));
}

const STATUS_MIN_C = 0.049, STATUS_DISTANCE = 0.054;
function statusDistinct(color, accent) {
  if (!accent) return null;
  const a = lch(color), b = lch(accent);
  return b.c < 0.045 || angleGap(a.h, b.h) > 26 || statusDistance(color, accent) >= STATUS_DISTANCE || Math.abs(a.l - b.l) >= 0.145;
}
function semantics(color, key, accent) {
  const [middle, width] = STATUS[key], { c, h } = lch(color);
  return c >= STATUS_MIN_C && angleGap(h, middle) <= width && statusDistinct(color, accent) !== false;
}

function statusCandidate(original, backgrounds, accent, key) {
  const origin = lab(original), { l, h, c } = lch(original);
  const [center, width] = STATUS[key];
  const base = fit(original, backgrounds, 3);
  if (base && semantics(base, key, accent)) return base;
  let best = null, distance = Infinity;
  const candidateHues = [h, center, center - width * 0.88, center + width * 0.88, center - width * 0.49, center + width * 0.49];
  const candidateChroma = [Math.max(0.067, c), 0.077, 0.135, 0.20];
  for (const tone of [l, l - 0.15, l + 0.15, l - 0.24, l + 0.24]) {
    for (const hue of candidateHues) {
      if (angleGap(hue, center) > width) continue;
      for (const chroma of candidateChroma) {
        const start = fromLch(tone, chroma, hue, original.a);
        const next = fit(start, backgrounds, 3);
        if (!next || !semantics(next, key, accent)) continue;
        const d = delta(origin, lab(next)) + Math.abs(original.a - next.a) * 0.12;
        if (d < distance) { best = next; distance = d; }
      }
    }
    if (best) break;
  }
  return best ?? base;
}

const visible = (model, short, fill = model.canvas) => {
  const color = model.color(short);
  return color && (fill ? over(color, fill) : color.a === 1 ? color : null);
};
const fillName = (name) => prefix(Object.hasOwn(SELECTION_BASES, name) ? EFFECTIVE_FILLS.selection
  : Object.hasOwn(INLINE_BASES, name) ? EFFECTIVE_FILLS.inline : EFFECTIVE_FILLS[name]);

function minRatio(color, backdrops) {
  if (!color || backdrops.some((bg) => !bg)) return null;
  return Math.min(...backdrops.map((bg) => ratio(color, bg)));
}

function selectionInk(model) {
  const value = model.value('interactive.selectionForeground'), bg = model.back('selection');
  return bg && rgb(value) ? rgb(readableText(value, hex(bg))) : null;
}

function allChecks(model) {
  const checks = [];
  function contrastRule(rule) {
    const { path, code, minimum, surfaces: backdrops } = rule;
    const value = model.value(path);
    let color = model.color(path);
    if (path === 'interactive.selectionForeground') color = selectionInk(model);
    for (const backdrop of backdrops) {
      const bg = model.back(backdrop);
      const actual = color && bg ? ratio(color, bg) : null;
      checks.push(entry(code, prefix(path), { against: fillName(backdrop), value, actual, minimum,
        pass: actual === null ? null : actual >= minimum, severity: actual !== null && actual < minimum ? 'error' : 'info',
        ...(Object.hasOwn(INLINE_BASES, backdrop) ? { backdrop: fillName(INLINE_BASES[backdrop]), treatment: 'markdown-inline' } : {}),
        ...(path === 'interactive.selectionForeground' && color ? { effective: hex(color) } : {}),
      }));
    }
  }
  for (const rule of [...EDGE_RULES, ...TEXT_RULES]) contrastRule(rule);
  for (const { path, surfaces: names, minimum } of ROW_RULES) {
    const actual = minRatio(model.color(path), names.map(model.back));
    checks.push(entry('selected-row-contrast', prefix(path), { against: 'colors.interactive.selection',
      value: model.value(path), actual, minimum, pass: actual === null ? null : actual >= minimum,
      severity: actual !== null && actual < minimum ? 'error' : 'info',
    }));
  }
  for (const item of LAYERS) for (const against of item.against) {
    const a = visible(model, item.path), b = model.back(against);
    const actual = a && b ? delta(lab(a), lab(b)) : null;
    checks.push(entry('layer', prefix(item.path), { against: fillName(against), value: model.value(item.path), actual, minimum: 0.026, pass: actual === null ? null : actual >= 0.026 }));
  }
  for (const alpha of [0.40, 0.70, 1]) {
    const border = model.color('interactive.border'), bg = model.canvas;
    const actual = border && bg ? ratio({ ...border, a: border.a * alpha }, bg) : null;
    checks.push(entry('soft-border', 'colors.interactive.border', { against: fillName('canvas'), value: model.value('interactive.border'), actual,
      minimum: 3, opacityFactor: alpha, pass: actual === null ? null : actual >= 3, severity: 'info' }));
  }
  for (const [key, [expectedHue, width]] of Object.entries(STATUS)) {
    const path = `status.${key}`, fg = visible(model, path);
    const color = fg && lch(fg);
    const gap = color ? angleGap(color.h, expectedHue) : null;
    checks.push(entry('status-hue', prefix(path), { value: model.value(path), actual: gap, pass: gap === null ? null : gap <= width && color.c >= STATUS_MIN_C,
      maximum: width, chroma: color?.c, threshold: { hue: expectedHue, tolerance: width, chroma: STATUS_MIN_C } }));
    const accent = visible(model, 'primary.base');
    const actual = statusDistance(fg, accent);
    checks.push(entry('status-accent', prefix(path), { against: 'colors.primary.base', value: model.value(path), actual,
      minimum: STATUS_DISTANCE, pass: fg ? statusDistinct(fg, accent) : null, threshold: { chromaDistance: STATUS_DISTANCE, withinHueDegrees: 26, accentChroma: 0.045, lightnessDistance: 0.145 } }));
  }
  for (const { a, b, actual } of syntaxPairs(model)) checks.push(entry('syntax-separation', `colors.syntax.base.${a}`, { against: `colors.syntax.base.${b}`,
    value: model.value(`syntax.base.${a}`), actual, minimum: SYNTAX_DELTA, pass: actual === null ? null : actual >= SYNTAX_DELTA }));
  for (const [a, b, fill, minimum] of [
    ['syntax.highlights.diffAdded', 'syntax.highlights.diffRemoved', model.back('code'), 0.074],
    ['tools.edit.addedBackground', 'tools.edit.removedBackground', model.canvas, 0.040],
  ]) {
    const first = visible(model, a, fill), second = visible(model, b, fill);
    const actual = first && second ? redGreenDistance(first, second) : null;
    checks.push(entry('diff-cvd', prefix(a), { against: prefix(b), value: model.value(a), actual, minimum, pass: actual === null ? null : actual >= minimum }));
  }
  return checks;
}

/** A model of documented placements, not a browser accessibility certification. */
export function auditTheme(definition) {
  let model;
  try { model = view(definition); }
  catch (error) {
    if (!error.issues) throw error;
    const issues = error.issues.map((problem) => entry('invalid-field', problem.path.join('.') || '(theme)', {
      actual: problem.code, value: get(definition, problem.path.join('.')), pass: false, severity: 'error', threshold: problem.expected ?? problem.values ?? problem.message,
    }));
    return { score: 0, status: 'invalid', summary: { errors: issues.length, warnings: 0, notes: 0, unmeasured: 0, passed: 0 }, checks: issues, issues };
  }
  const checks = [...allChecks(model), ...diagnostics(definition)];
  const issues = checks.filter(({ pass }) => pass === false);
  const errors = issues.filter(({ severity }) => severity === 'error').length;
  const warnings = issues.filter(({ severity }) => severity === 'warning').length;
  const notes = issues.length - errors - warnings;
  const unmeasured = checks.filter(({ pass }) => pass === null).length;
  const passed = checks.length - unmeasured - issues.length;
  const score = Math.max(0, Math.min(errors > 0 ? 84 : 100, 100 - errors * 4 - warnings * 2 - Math.min(15, unmeasured)));
  return { score, status: errors ? 'attention' : warnings || unmeasured ? 'review' : 'healthy',
    summary: { errors, warnings, notes, unmeasured, passed }, checks, issues };
}

function adjustLayers(editor) {
  let model = view(editor.draft);
  for (const { path, against } of LAYERS) {
    // A bubble inherits the elevated surface; no reason to duplicate it if
    // the underlying colour is sufficient.
    const front = visible(model, path), backgrounds = against.map(model.back).filter(Boolean);
    if (!front || !backgrounds.length) continue;
    const tests = backgrounds.map(lab);
    const passes = (candidate) => tests.every((bg) => delta(lab(candidate), bg) >= 0.026);
    if (passes(front)) continue;
    const current = lch(front);
    let found;
    for (let i = 1; i <= 16 && !found; i++) {
      for (const direction of model.dark ? [1, -1] : [-1, 1]) {
        const candidate = fromLch(current.l + direction * i * 0.005, current.c, current.h);
        if (passes(candidate)) { found = candidate; break; }
      }
    }
    if (found) {
      editor.set(prefix(path), hex(found), 'layer');
      model = view(editor.draft);
    }
  }
}

function applyRules(editor, rules, model) {
  for (const { path, surfaces: names, minimum, code } of rules) {
    const color = model.color(path);
    const backgrounds = names.map(model.back).filter(Boolean);
    if (!color || !backgrounds.length) continue;
    if (path === 'interactive.selectionForeground' && minRatio(selectionInk(model), backgrounds) >= minimum) continue;
    const next = fit(color, backgrounds, minimum);
    if (next && next !== color) editor.set(prefix(path), hex(next), names.length === 1 && names[0] === 'selection' ? 'selection-text' : code);
  }
}

function repairSelectedRows(editor) {
  const model = view(editor.draft), selection = model.color('interactive.selection');
  const bases = Object.values(SELECTION_BASES).map(model.back);
  if (!selection || bases.some((bg) => !bg)) return;
  const selected = SELECTED_ROWS.map(model.back);
  const failed = ROW_RULES.filter(({ path, minimum }) => {
    const actual = minRatio(model.color(path), selected);
    return actual !== null && actual < minimum;
  });
  if (!failed.length && minRatio(selectionInk(model), Object.keys(SELECTION_BASES).map(model.back)) >= 4.5) return;

  // Prefer to preserve the chosen fill. Fix only the fixed-label colours
  // that fail, retaining their usual contrast and the meaning of state hues.
  const fixes = [];
  for (const { path, minimum } of failed) {
    const role = [...EDGE_RULES, ...TEXT_RULES].find((rule) => rule.path === path);
    const value = model.color(path);
    const backgrounds = [...selected, ...(role?.surfaces ?? []).map(model.back)].filter(Boolean);
    const base = fit(value, backgrounds, minimum);
    const status = path.startsWith('status.') ? path.slice(7) : null;
    const accent = visible(model, 'primary.base');
    const candidate = status && (!base || !semantics(over(base, model.canvas), status, accent))
      ? statusCandidate(visible(model, path), backgrounds, accent, status)
      : base;
    if (!candidate || minRatio(candidate, backgrounds) < minimum
      || (status && !semantics(over(candidate, model.canvas), status, accent))) break;
    fixes.push({ path, value: hex(candidate) });
  }
  if (fixes.length === failed.length && minRatio(selectionInk(model), Object.keys(SELECTION_BASES).map(model.back)) >= 4.5) {
    for (const item of fixes) editor.set(prefix(item.path), item.value, 'selected-row-contrast');
    return;
  }

  // Inverted fills often demand contradictory light/dark text. Reproject the
  // fill instead of forcing every other row / badge to change. Try the same
  // hue and alpha first, then a neutral tone on the same canvas polarity.
  const front = model.color('interactive.selectionForeground'), original = lch(selection);
  const candidates = [];
  for (const alpha of new Set([original.a, 1])) for (const tint of [original.c, 0]) {
    for (let i = 0; i <= 27; i++) {
      const l = model.dark ? 0.07 + i * 0.024 : 0.985 - i * 0.024;
      const chip = fromLch(l, tint, original.h, alpha);
      if ([bases[0], bases[3]].some((bg) => ratio(chip, bg) < 1.24)) continue;
      const fills = bases.map((base) => over(chip, base));
      if (!ROW_RULES.every(({ path, minimum }) => {
        const actual = minRatio(model.color(path), fills.slice(0, 3));
        return actual === null || actual >= minimum;
      })) continue;
      const ink = front && fit(front, fills, 4.5);
      if (!ink) continue;
      const d = delta(lab(over(selection, bases[0])), lab(fills[0])) + Math.abs(alpha - original.a) * 0.085;
      candidates.push({ chip, ink, distance: d });
    }
  }
  const best = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (best) {
    editor.set('colors.interactive.selection', hex(best.chip), 'selected-row-contrast');
    const automaticText = selectionInk(view(editor.draft));
    if (minRatio(automaticText, bases.map((bg) => over(best.chip, bg))) < 4.5) {
      editor.set('colors.interactive.selectionForeground', hex(best.ink), 'selected-row-contrast');
    }
  }
}

function fixDiff(editor) {
  const model = view(editor.draft), background = model.back('code');
  const a = visible(model, 'syntax.highlights.diffAdded', background);
  const b = visible(model, 'syntax.highlights.diffRemoved', background);
  if (!a || !b || !background || redGreenDistance(a, b) >= 0.074) return;
  // TextMate metadata will still inherit the authored/default fill. Shift
  // one foreground's lightness only if this actually improves separation.
  for (let step = 1; step <= 8; step++) {
    for (const [key, source, other] of [['diffAdded', a, b], ['diffRemoved', b, a]]) {
      const color = lch(source);
      for (const sign of model.dark ? [1, -1] : [-1, 1]) {
        const candidate = fromLch(color.l + sign * step * 0.012, color.c, color.h);
        if (ratio(candidate, background) >= 3 && redGreenDistance(candidate, other) >= 0.074) {
          editor.set(`colors.syntax.highlights.${key}`, hex(candidate), 'diff-cvd'); return;
        }
      }
    }
  }
}

function normalizeColors(editor, model) {
  for (const field of LIVE_COLORS) {
    const original = get(editor.draft, field.path);
    if (original === undefined || rgb(original)) continue;
    const short = field.path.slice(7), statusKey = Object.keys(STATUS).find((key) => short === `status.${key}`);
    const isFill = Object.values(EFFECTIVE_FILLS).includes(short) && !short.endsWith('.base') && !statusKey;
    const c = model.dark;
    const substitute = statusKey ? swatch(c ? 0.68 : 0.51, 0.13, STATUS[statusKey][0])
      : short === 'primary.base' ? swatch(c ? 0.73 : 0.51, 0.126, 252)
        : isFill ? swatch(c ? 0.21 : 0.96, 0.012, 252)
          : swatch(c ? 0.83 : 0.28, 0.021, 252);
    editor.set(field.path, substitute, 'not-computable');
  }
}

/**
 * Repair measured failures; keep unmeasurable writing intact unless the
 * caller explicitly asks for numerical HEX alternatives. Advisory checks
 * (weak CSS opacity, diagnostics and diff tint simulation) are not a license
 * to redesign passing fields.
 */
export function repairTheme(definition, { normalizeUnsupported = false, layers = true, diff = true } = {}) {
  let model = view(definition);
  const editor = edit(definition);
  if (normalizeUnsupported) {
    normalizeColors(editor, model);
    model = view(editor.draft);
  }
  if (layers) { adjustLayers(editor); model = view(editor.draft); }
  // First fix the accent, then check state hues relative to the actual result.
  applyRules(editor, EDGE_RULES.filter(({ path }) => !path.startsWith('status.') && !path.startsWith('syntax.highlights.')), model);
  model = view(editor.draft);
  for (const key of Object.keys(STATUS)) {
    const path = `status.${key}`, base = model.color(path);
    if (!base) continue;
    const backgrounds = surfaces.map(model.back).filter(Boolean);
    const dominant = model.canvas ? over(base, model.canvas) : base;
    if (semantics(dominant, key, visible(model, 'primary.base')) && backgrounds.every((bg) => ratio(base, bg) >= 3)) continue;
    const candidate = statusCandidate(dominant, backgrounds, visible(model, 'primary.base'), key);
    if (candidate && hex(candidate) !== model.value(path)) editor.set(prefix(path), hex(candidate), 'status');
  }
  model = view(editor.draft);
  applyRules(editor, EDGE_RULES.filter(({ path }) => path.startsWith('syntax.highlights.')), model);
  // Parent text roles first. This avoids baking out aliases whose inherited
  // source can satisfy them on its own.
  applyRules(editor, TEXT_RULES.slice(0, 8), model);
  // A status ink approved for a selected row also seeds default diff fills
  // and number colours. Do the row pass before fitting those dependents.
  repairSelectedRows(editor);
  model = view(editor.draft);
  applyRules(editor, TEXT_RULES.slice(5, 8), model);
  applyRules(editor, TEXT_RULES.slice(8, 8 + BASE_SYNTAX.length), model);
  model = view(editor.draft);
  applyRules(editor, TEXT_RULES.slice(8 + BASE_SYNTAX.length), model);
  if (diff) fixDiff(editor);
  return editor.result();
}

export function hasVitalFailure(definition) {
  const model = view(definition);
  for (const { path, surfaces: backdrops, minimum } of [...EDGE_RULES, ...TEXT_RULES, ...ROW_RULES]) {
    const color = path === 'interactive.selectionForeground' ? selectionInk(model) : model.color(path);
    for (const name of backdrops) {
      const bg = model.back(name);
      if (!bg || !color) return true;
      if (ratio(color, bg) < minimum) return true;
    }
  }
  const accent = visible(model, 'primary.base');
  return Object.keys(STATUS).some((key) => {
    const color = visible(model, `status.${key}`);
    return !color || !semantics(color, key, accent);
  });
}
