/**
 * OpenChamber v2.8.0 (30c70496a5ca0105e04e60a783964576973edc8f).
 * Port of lib/theme/{definition,color,syntax,readableColors,cssGenerator}.ts
 * and the typography constants from lib/typography.ts. The validation port
 * works on JSON documents, without Zod or any browser API. No DOM writes.
 *
 * MIT License — Copyright (c) 2025 Bohdan Triapitsyn
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Match the upstream numeric parser, not browser CSS parsing.
export function parseColor(value) {
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1];
  if (hex) {
    const full = hex.length < 5 ? [...hex].map((c) => c + c).join('') : hex;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value.trim());
  if (!rgb) return null;
  const r = Number(rgb[1]), g = Number(rgb[2]), b = Number(rgb[3]), a = rgb[4] === undefined ? 1 : Number(rgb[4]);
  return [r, g, b].every((c) => c >= 0 && c <= 255) && a >= 0 && a <= 1 ? { r, g, b, a } : null;
}

function over(front, back) {
  return { r: front.r * front.a + back.r * (1 - front.a), g: front.g * front.a + back.g * (1 - front.a), b: front.b * front.a + back.b * (1 - front.a), a: 1 };
}

function luminance(c) {
  const linear = (v) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  return linear(c.r) * 0.2126 + linear(c.g) * 0.7152 + linear(c.b) * 0.0722;
}

function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hexColor = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function contrastRatio(foreground, background, canvas = '#ffffff') {
  const fg = parseColor(foreground), bg = parseColor(background), under = parseColor(canvas);
  if (!fg || !bg || !under) return null;
  const surface = over(bg, under);
  return ratio(over(fg, surface), surface);
}

export function readableText(foreground, background, canvas = '#ffffff') {
  const fg = parseColor(foreground), bg = parseColor(background), under = parseColor(canvas);
  if (!fg || !bg || !under) return foreground;
  const surface = over(bg, under);
  if (ratio(over(fg, surface), surface) >= 4.5) return foreground;
  const black = { r: 0, g: 0, b: 0, a: 1 }, white = { r: 255, g: 255, b: 255, a: 1 };
  const target = ratio(black, surface) >= ratio(white, surface) ? black : white;
  let low = 0, high = 1, result = target;
  for (let step = 0; step < 16; step++) {
    const amount = (low + high) / 2;
    const candidate = { r: Math.round(fg.r + (target.r - fg.r) * amount), g: Math.round(fg.g + (target.g - fg.g) * amount), b: Math.round(fg.b + (target.b - fg.b) * amount), a: 1 };
    if (ratio(candidate, surface) >= 4.6) { result = candidate; high = amount; }
    else low = amount;
  }
  return hexColor(result);
}

export function onColor(background, canvas) {
  const black = contrastRatio('#000000', background, canvas);
  const white = contrastRatio('#ffffff', background, canvas);
  return black !== null && white !== null && black >= white ? '#000000' : '#ffffff';
}

export function toHexColor(value) {
  const color = parseColor(value);
  if (!color) return null;
  return color.a < 1 ? `${hexColor(color)}${Math.round(color.a * 255).toString(16).padStart(2, '0')}` : hexColor(color);
}

export function withOpacity(value, alpha) {
  const color = parseColor(value);
  return color ? `${hexColor(color)}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : `color-mix(in srgb, ${value} ${alpha * 100}%, transparent)`;
}

export function mixColor(foreground, background, amount, canvas = '#ffffff') {
  const fg = parseColor(foreground), bg = parseColor(background), under = parseColor(canvas);
  return fg && bg && under ? hexColor(over({ ...fg, a: fg.a * amount }, over(bg, under))) : `color-mix(in srgb, ${foreground} ${amount * 100}%, ${background})`;
}

function oklab(color) {
  const linear = (value) => value / 255 <= 0.04045 ? value / 3294.6 : ((value / 255 + 0.055) / 1.055) ** 2.4;
  const r = linear(color.r), g = linear(color.g), b = linear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function fromOklab(lab) {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  const gamma = (v) => 255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  return {
    r: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

export function tintColor(accent, surface, amount, canvas = '#ffffff') {
  const tint = parseColor(accent), base = parseColor(surface), under = parseColor(canvas);
  if (!tint || !base || !under) return surface;
  const x = oklab(over(base, under)), y = oklab(over(tint, under));
  return hexColor(fromOklab({ l: x.l, a: x.a + (y.a - x.a) * amount, b: x.b + (y.b - x.b) * amount }));
}

export function chromaticDistance(first, second, background, canvas = '#ffffff') {
  const a = parseColor(first), b = parseColor(second), bg = parseColor(background), under = parseColor(canvas);
  if (!a || !b || !bg || !under) return null;
  const surface = over(bg, under);
  const x = oklab(over(a, surface)), y = oklab(over(b, surface));
  return Math.hypot(x.a - y.a, x.b - y.b);
}

export function colorHue(value, canvas) {
  const color = parseColor(value), background = parseColor(canvas);
  if (!color || !background) return null;
  const lab = oklab(over(color, background));
  return Math.hypot(lab.a, lab.b) < 0.025 ? null : (Math.atan2(lab.b, lab.a) * 180 / Math.PI + 360) % 360;
}

const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([\w#.,%\s/+()-]*\))$/i;
const LOADS_RESOURCE = /\b(?:url|image|image-set|cross-fade|element)\s*\(|@import/i;
const UNSUPPORTED_CSS_VALUE = /[;{}<>\\]/;
const obj = (shape) => ({ type: 'object', shape });
const optional = (rule) => ({ ...rule, optional: true });
const defaulted = (rule, value) => ({ ...rule, default: value });
const str = { type: 'string' };
const text = { ...str, trim: true };
const color = { ...text, constraint: (v) => COLOR_PATTERN.test(v) && !LOADS_RESOURCE.test(v), message: 'Expected a CSS colour' };
const css = { ...str, constraint: (v) => !UNSUPPORTED_CSS_VALUE.test(v) && !LOADS_RESOURCE.test(v), message: 'Unsupported CSS value' };
const colorMap = (keys) => optional({ type: 'record', keys });
const colors = (required, overrides) => Object.fromEntries([
  ...required.map((key) => [key, color]),
  ...overrides.map((key) => [key, optional(color)]),
]);
const STATUS_KEYS = ['error', 'warning', 'success', 'info'];
const SYNTAX_BASE_KEYS = ['comment', 'keyword', 'string', 'number', 'function', 'variable', 'type', 'operator'];
export const SYNTAX_TOKEN_KEYS = Object.freeze(Object.keys(resolveSyntaxTokens({ base: {} })));
export const SYNTAX_HIGHLIGHT_KEYS = Object.freeze([
  'diffAdded', 'diffAddedBackground', 'diffRemoved', 'diffRemovedBackground',
  'diffModified', 'diffModifiedBackground', 'lineNumber', 'lineNumberActive',
]);
const safeSyntaxKeys = {
  tokens: new Set(SYNTAX_TOKEN_KEYS),
  highlights: new Set(SYNTAX_HIGHLIGHT_KEYS),
};
const SYNTAX_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const DEFINITION = obj({
  metadata: obj({
    id: text, name: text, variant: { type: 'enum', values: ['light', 'dark'] },
    description: defaulted(str, ''), version: defaulted(str, '1.0.0'),
    author: optional(str), tags: defaulted({ type: 'array', item: str }, []),
  }),
  colors: obj({
    primary: obj(colors(['base'], ['foreground', 'hover', 'active', 'muted'])),
    surface: obj(colors(['background', 'foreground', 'muted', 'mutedForeground', 'elevated'], ['elevatedForeground', 'overlay', 'subtle'])),
    interactive: obj(colors(['border'], ['selection', 'selectionForeground', 'borderHover', 'borderFocus', 'focus', 'focusRing', 'cursor', 'hover', 'active'])),
    status: obj(Object.fromEntries(STATUS_KEYS.flatMap((key) => [
      [key, color], ...['Foreground', 'Background', 'Border'].map((suffix) => [key + suffix, optional(color)]),
    ]))),
    syntax: obj({
      base: obj({ ...colors([], ['background', 'foreground']), ...colors(SYNTAX_BASE_KEYS, []) }),
      tokens: colorMap(), highlights: colorMap(),
    }),
    pr: optional(obj(colors([], ['open', 'draft', 'blocked', 'merged', 'closed']))),
    chat: colorMap(['background', 'userMessageBackground', 'divider']),
    markdown: colorMap(['link', 'linkHover', 'inlineCode', 'inlineCodeBackground', 'blockquote', 'blockquoteBorder', 'listMarker', 'bold', 'italic', 'strikethrough', 'hr']),
    tools: optional(obj({
      ...colors([], ['border', 'icon', 'title', 'description']),
      edit: colorMap(['addedBackground', 'removedBackground', 'modifiedBackground', 'lineNumber']),
    })),
  }),
  config: optional(obj({
    fonts: optional(obj({ sans: optional(css), mono: optional(css), heading: optional(css) })),
    transitions: optional(obj({ fast: optional(css), normal: optional(css), slow: optional(css) })),
  })),
});

const receivedType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function readDefinition(input, { syntaxPolicy = 'allowlist' } = {}) {
  const issues = [];
  const warnings = [];
  const typeIssue = (path, expected, value) => issues.push({
    expected, code: 'invalid_type', path, message: `Invalid input: expected ${expected}, received ${receivedType(value)}`,
  });
  const read = (rule, value, path) => {
    if (value === undefined) {
      if ('default' in rule) return Array.isArray(rule.default) ? [...rule.default] : rule.default;
      if (rule.optional) return undefined;
    }
    if (rule.type === 'enum') {
      if (!rule.values.includes(value)) issues.push({
        code: 'invalid_value', values: [...rule.values], path,
        message: `Invalid option: expected one of ${rule.values.map((item) => JSON.stringify(item)).join('|')}`,
      });
      return value;
    }
    const expected = rule.type === 'record' ? 'record' : rule.type;
    if (receivedType(value) !== (rule.type === 'record' ? 'object' : rule.type)) {
      typeIssue(path, expected, value);
      // Zod's min-length check also runs on wrong-typed JSON with numeric .length.
      if (rule.trim && typeof value?.length === 'number' && value.length < 1) {
        const origin = Array.isArray(value) ? 'array' : 'unknown';
        issues.push({ origin, code: 'too_small', minimum: 1, inclusive: true, path,
          message: origin === 'array' ? 'Too small: expected array to have >=1 items' : 'Too small: expected unknown to be >=1',
        });
      }
      return undefined;
    }
    switch (rule.type) {
      case 'object': {
        const result = {};
        for (const [key, child] of Object.entries(rule.shape)) {
          const own = Object.hasOwn(value, key);
          const parsed = read(child, own ? value[key] : undefined, [...path, key]);
          if (parsed !== undefined || own) result[key] = parsed;
        }
        return result;
      }
      case 'record': {
        const result = {};
        const allowlist = syntaxPolicy !== 'upstream' && path[0] === 'colors' && path[1] === 'syntax' && safeSyntaxKeys[path[2]];
        for (const [key, item] of Object.entries(value)) {
          if (allowlist && (!SYNTAX_KEY_PATTERN.test(key) || !allowlist.has(key))) {
            warnings.push({ code: 'unknown_syntax_key', path: [...path, key], message: 'Unsupported syntax key ignored' });
            continue;
          }
          if (key === '__proto__') continue; // same as Zod 4
          const parsed = read(color, item, [...path, key]);
          if (!rule.keys || rule.keys.includes(key)) result[key] = parsed;
        }
        return result;
      }
      case 'array':
        return value.map((item, index) => read(rule.item, item, [...path, index]));
      case 'string': {
        const parsed = rule.trim ? value.trim() : value;
        if (rule.trim && !parsed) issues.push({
          origin: 'string', code: 'too_small', minimum: 1, inclusive: true, path,
          message: 'Too small: expected string to have >=1 characters',
        });
        if (rule.constraint && !rule.constraint(parsed)) issues.push({ code: 'custom', path, message: rule.message });
        return parsed;
      }
      default:
        throw new Error(`Unknown theme validation rule: ${rule.type}`);
    }
  };
  return { value: read(DEFINITION, input, []), issues, warnings };
}

/** Structural issues (paths are arrays, including array indices). Use inspectThemeImport for import warnings. */
export function validateTheme(input, options) {
  return readDefinition(input, options).issues;
}

/** Safe third-party import. Present warnings before saving the sanitized definition. */
export function inspectThemeImport(input) {
  const { value, issues, warnings } = readDefinition(input);
  return { definition: issues.length ? null : value, issues, warnings };
}

export class ThemeValidationError extends TypeError {
  constructor(issues) {
    super(issues.map(({ path, message }) => `${path.join('.') || '(theme)'}: ${message}`).join('\n'));
    this.name = 'ThemeValidationError';
    this.issues = issues;
  }
}

function requireDefinition(input, options) {
  const { value, issues } = readDefinition(input, options);
  if (issues.length) throw new ThemeValidationError(issues);
  return value;
}

export function resolveSyntaxTokens(syntax) {
  const b = syntax.base;
  const t = syntax.tokens ?? {};
  const property = t.variableProperty ?? b.variable;
  const className = t.className ?? t.class ?? b.type;
  return {
    commentDoc: b.comment,
    stringEscape: b.foreground, stringInterpolation: b.variable, stringRegex: b.string,
    keywordControl: b.keyword, keywordOperator: b.operator, keywordImport: b.operator, keywordReturn: b.keyword,
    storageModifier: b.keyword,
    functionCall: b.function, functionBuiltin: b.function, method: b.function, methodCall: t.method ?? b.function,
    variableBuiltin: b.variable, variableProperty: property, variableReadonly: b.number,
    variableOther: b.variable, variableGlobal: b.string, variableLocal: b.variable,
    parameter: t.stringEscape ?? b.foreground,
    typePrimitive: b.type, typeInterface: t.interface ?? b.type, interface: b.type,
    class: className, className, struct: className, enum: className, typeParameter: b.type,
    boolean: b.keyword, null: b.number, constant: b.number,
    punctuation: b.comment, delimiter: t.punctuation ?? b.comment, bracket: b.foreground,
    tag: b.keyword, jsxTag: t.tag ?? b.keyword, tagAttribute: property, tagAttributeValue: b.string,
    tagBracket: t.punctuation ?? b.comment,
    decorator: b.function, annotation: b.function, namespace: b.type, module: b.operator,
    label: b.operator, macro: b.keyword, preprocessor: b.operator, regex: b.string, url: b.string,
    key: property, exception: b.operator,
    ...t,
  };
}

/**
 * Resolve defaults. Known/sanitized input exactly matches upstream `requireTheme`.
 * `syntaxPolicy: 'upstream'` is for research parity only, not import or preview.
 */
export function parseTheme(input, options) {
  const { metadata, colors: c, config } = requireDefinition(input, options);
  const neutral = metadata.variant === 'dark' ? '#ffffff' : '#000000';
  const p = c.primary.base;
  const s = { ...c.surface, elevatedForeground: c.surface.elevatedForeground ?? c.surface.foreground, overlay: c.surface.overlay ?? withOpacity('#000000', 0.6), subtle: c.surface.subtle ?? c.surface.muted };
  const selection = c.interactive.selection ?? withOpacity(s.foreground, 0.16);
  const base = { ...c.syntax.base, background: c.syntax.base.background ?? s.background, foreground: c.syntax.base.foreground ?? s.foreground };
  const statusFamily = (name) => ({
    base: c.status[name],
    foreground: c.status[`${name}Foreground`] ?? onColor(c.status[name], s.background),
    background: c.status[`${name}Background`] ?? withOpacity(c.status[name], 0.125),
    border: c.status[`${name}Border`] ?? withOpacity(c.status[name], 0.314),
  });
  const error = statusFamily('error'), warning = statusFamily('warning'), success = statusFamily('success'), info = statusFamily('info');
  const diffAdded = c.syntax.highlights?.diffAdded ?? success.base;
  const diffRemoved = c.syntax.highlights?.diffRemoved ?? error.base;
  const diffModified = c.syntax.highlights?.diffModified ?? info.base;
  const highlights = {
    diffAdded, diffAddedBackground: withOpacity(diffAdded, 0.125),
    diffRemoved, diffRemovedBackground: withOpacity(diffRemoved, 0.125),
    diffModified, diffModifiedBackground: withOpacity(diffModified, 0.125),
    lineNumber: s.mutedForeground, lineNumberActive: base.foreground,
    ...c.syntax.highlights,
  };
  return {
    metadata,
    colors: {
      primary: { ...c.primary, foreground: c.primary.foreground ?? onColor(p, s.background), hover: c.primary.hover ?? mixColor(p, neutral, 0.9), active: c.primary.active ?? mixColor(p, neutral, 0.8) },
      surface: s,
      interactive: {
        borderHover: mixColor(c.interactive.border, s.foreground, 0.7), borderFocus: p, focus: p, focusRing: withOpacity(p, 0.5), cursor: base.foreground,
        hover: withOpacity(s.foreground, 0.07), active: withOpacity(s.foreground, 0.12),
        ...c.interactive, selection, selectionForeground: c.interactive.selectionForeground ?? readableText(s.foreground, selection, s.background),
      },
      status: {
        error: error.base, errorForeground: error.foreground, errorBackground: error.background, errorBorder: error.border,
        warning: warning.base, warningForeground: warning.foreground, warningBackground: warning.background, warningBorder: warning.border,
        success: success.base, successForeground: success.foreground, successBackground: success.background, successBorder: success.border,
        info: info.base, infoForeground: info.foreground, infoBackground: info.background, infoBorder: info.border,
      },
      pr: { open: success.base, draft: s.mutedForeground, blocked: warning.base, merged: metadata.variant === 'dark' ? '#8957e5' : '#8250df', closed: error.base, ...c.pr },
      syntax: { base, tokens: resolveSyntaxTokens({ base, tokens: c.syntax.tokens }), highlights },
      chat: c.chat, markdown: c.markdown, tools: c.tools,
    },
    config,
  };
}

const equalColor = (a, b) => a.toLowerCase() === b?.toLowerCase();

function prune(values, inherited, keep = []) {
  const result = { ...values };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (value !== undefined && !keep.includes(key) && equalColor(value, inherited[key])) delete result[key];
  }
  return result;
}

/** Upstream compaction on known keys. For behavior-preserving export use compactThemeLossless. */
export function compactTheme(input, options) {
  const source = requireDefinition(input, options);
  const c = source.colors;
  const defaults = parseTheme({ metadata: source.metadata, colors: {
    primary: { base: c.primary.base },
    surface: { background: c.surface.background, foreground: c.surface.foreground, muted: c.surface.muted, mutedForeground: c.surface.mutedForeground, elevated: c.surface.elevated },
    interactive: { border: c.interactive.border },
    status: { error: c.status.error, warning: c.status.warning, success: c.status.success, info: c.status.info },
    syntax: { base: c.syntax.base },
  } }, options);
  c.primary = prune(c.primary, { ...defaults.colors.primary }, ['base']);
  c.surface = prune(c.surface, { ...defaults.colors.surface }, ['background', 'foreground', 'muted', 'mutedForeground', 'elevated']);
  c.interactive = prune(c.interactive, { ...defaults.colors.interactive }, ['border']);
  c.status = prune(c.status, { ...defaults.colors.status }, STATUS_KEYS);
  c.syntax.base = prune(c.syntax.base, { background: c.surface.background, foreground: c.surface.foreground }, SYNTAX_BASE_KEYS);
  if (c.syntax.tokens) {
    for (const key of Object.keys(c.syntax.tokens)) {
      const candidate = { ...c.syntax.tokens };
      delete candidate[key];
      const inherited = resolveSyntaxTokens({ base: defaults.colors.syntax.base, tokens: candidate });
      if (equalColor(c.syntax.tokens[key], new Map(Object.entries(inherited)).get(key))) delete c.syntax.tokens[key];
    }
    if (!Object.keys(c.syntax.tokens).length) delete c.syntax.tokens;
  }
  if (c.syntax.highlights) {
    const diffColors = ['diffAdded', 'diffRemoved', 'diffModified'];
    const inherited = parseTheme({ ...source, colors: { ...c, syntax: { base: c.syntax.base, tokens: c.syntax.tokens, highlights: Object.fromEntries(Object.entries(c.syntax.highlights).filter(([key]) => diffColors.includes(key))) } } }, options);
    c.syntax.highlights = prune(c.syntax.highlights, inherited.colors.syntax.highlights ?? {}, diffColors);
  }
  if (c.pr) {
    const inherited = parseTheme({ ...source, colors: { ...c, pr: undefined } }, options);
    c.pr = prune(c.pr, { ...inherited.colors.pr });
  }
  return source;
}

function equalTree(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalTree(a[key], b[key]));
}

/** Prune only upstream candidates whose removal preserves the resolved theme and ordered CSS. */
export function compactThemeLossless(input) {
  const source = requireDefinition(input);
  const compacted = compactTheme(source);
  const baseline = parseTheme(source);
  const css = generateThemeCss(baseline);
  const matchesBaseline = () => {
    const result = parseTheme(source);
    return equalTree(baseline, result) && css === generateThemeCss(result);
  };
  const pruneVerified = (original, candidate) => {
    for (const [key, value] of Object.entries(original)) {
      if (!Object.hasOwn(candidate, key)) {
        delete original[key];
        if (!matchesBaseline()) original[key] = value;
      } else if (value && candidate[key] && typeof value === 'object' && !Array.isArray(value)) {
        pruneVerified(value, candidate[key]);
      }
    }
  };
  const after = parseTheme(compacted);
  if (equalTree(baseline, after) && css === generateThemeCss(after)) return compacted;
  pruneVerified(source, compacted);
  // Reinsertions can move a declaration in open-ended ordered token records.
  return matchesBaseline() ? source : requireDefinition(input);
}

export function getReadableThemeColors(theme) {
  const { surface, primary, status, interactive } = theme.colors;
  const dark = theme.metadata.variant === 'dark';
  const tintedText = (seed, maximumTint) => {
    let text = seed;
    for (const background of [surface.background, surface.elevated, surface.muted]) {
      text = readableText(text, mixColor(seed, background, maximumTint, surface.background), surface.background);
    }
    return text;
  };
  return {
    tinted: {
      primary: tintedText(primary.base, dark ? 0.30 : 0.22),
      error: tintedText(status.error, dark ? 0.20 : 0.16),
      info: tintedText(status.info, 0.15),
      success: tintedText(status.success, 0.15),
      warning: tintedText(status.warning, 0.15),
    },
    status: Object.fromEntries(STATUS_KEYS.map((key) => [
      key, readableText(status[key], status[`${key}Background`], surface.background),
    ])),
    selectionForeground: readableText(interactive.selectionForeground, interactive.selection, surface.background),
  };
}

function hexToRgb(value) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized.startsWith('#')) return null;
  let hex = normalized.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((char) => char + char).join('');
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (hex.length !== 6) return null;
  const int = Number.parseInt(hex, 16);
  if (Number.isNaN(int)) return null;
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

function darken(color, percent) {
  if (!color.startsWith('#')) return color;
  const num = parseInt(color.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  const clamp = (value) => value < 255 ? value < 0 ? 0 : value : 255;
  return '#' + (0x1000000 + clamp(R) * 0x10000 + clamp(G) * 0x100 + clamp(B)).toString(16).slice(1);
}

const kebabCase = (key) => key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const REGULAR_WEIGHT = 'var(--ui-regular-font-weight, 400)';
const HEADING_HEIGHTS = ['1.25rem', '1.25rem', '1.5rem', '1.5rem', '1.5rem', '1.5rem'];
const HEADING_SPACING = ['-0.025em', '-0.02em', '-0.015em', '-0.01em', '0', '0.01em'];

function addTypography(add, comment, vscode) {
  comment('Semantic Typography Variables');
  add('ui-regular-font-weight', '400');
  const semantic = [
    ['Markdown content - all markdown elements use same size', 'markdown', '0.875rem', '0.8438rem'],
    ['Code content - all code elements use same size', 'code', '0.75rem', '0.8125rem'],
    ['UI headers - dialog titles, panel headers', 'ui-header', '0.875rem', '0.8438rem'],
    ['UI labels - buttons, menus, navigation', 'ui-label', '0.84375rem', '0.7813rem'],
    ['Metadata - timestamps, status, helper text', 'meta', '0.78125rem', '0.7813rem'],
    ['Micro text - badges, shortcuts, indicators', 'micro', '0.75rem', '0.75rem'],
    ['Settings page titles - larger than section headers', 'settings-page-title', '1.0625rem', '1rem'],
  ];
  for (const [label, key, standard, vs] of semantic) {
    comment(label);
    add(`text-${key}`, vscode ? vs : standard);
  }
  const triplet = (prefix, height, spacing, weight) => {
    add(`${prefix}-line-height`, height);
    add(`${prefix}-letter-spacing`, spacing);
    add(`${prefix}-font-weight`, weight);
  };
  comment('Heading line height and letter spacing');
  HEADING_HEIGHTS.forEach((height, index) => add(`h${index + 1}-line-height`, height));
  HEADING_SPACING.forEach((spacing, index) => add(`h${index + 1}-letter-spacing`, spacing));
  comment('UI element line height and letter spacing');
  triplet('ui-button', '1.375rem', '0.02em', '500');
  triplet('ui-label', '1rem', '0.03em', '500');
  triplet('ui-caption', '1rem', '0.025em', REGULAR_WEIGHT);
  comment('Markdown line height and letter spacing');
  triplet('markdown-body', '1.5rem', '0', REGULAR_WEIGHT);
  HEADING_HEIGHTS.forEach((height, index) => {
    add(`markdown-h${index + 1}-line-height`, height);
    add(`markdown-h${index + 1}-letter-spacing`, HEADING_SPACING[index]);
  });
  add('markdown-list-line-height', '1.375rem');
  add('markdown-code-block-line-height', '1rem');
  triplet('ui-button-small', '1.25rem', '0.02em', '500');
  triplet('markdown-body-small', '1.375rem', '0', REGULAR_WEIGHT);
  triplet('ui-button-large', '1.5rem', '0.02em', '500');
  triplet('markdown-body-large', '1.625rem', '0', REGULAR_WEIGHT);
  comment('Code line height and letter spacing');
  triplet('code-inline', '1rem', '0', '400');
  triplet('code-block', 'round(1.4rem, 1px)', '0', '400');
  triplet('code-line-numbers', '1.25rem', '0', '400');
  comment('Additional UI element line height and letter spacing');
  triplet('ui-badge', '1rem', '0.025em', '500');
  triplet('ui-tooltip', '1rem', '0.025em', REGULAR_WEIGHT);
  triplet('ui-input', '1.375rem', '0.02em', REGULAR_WEIGHT);
  triplet('ui-helper-text', '1rem', '0.025em', REGULAR_WEIGHT);
  comment('Additional markdown line height and letter spacing');
  triplet('markdown-blockquote', '1.5rem', '0', REGULAR_WEIGHT);
  add('markdown-list-letter-spacing', '0');
  add('markdown-list-font-weight', REGULAR_WEIGHT);
  triplet('markdown-link', '1.5rem', '0', REGULAR_WEIGHT);
  triplet('markdown-code', 'round(1.35em, 1px)', '0', '400');
  add('markdown-code-block-letter-spacing', '0');
  add('markdown-code-block-font-weight', '400');
}

function generateDeclarations(theme, { vscode = false } = {}, emit, comment = () => {}) {
  const c = theme.colors;
  const { surface: s, primary: p, interactive: i, status: st, syntax, pr } = c;
  const add = (key, value, important = false) => emit(`--${key}`, String(value), important);
  const group = (prefix, object, keys) => {
    for (const key of keys) add(`${prefix}-${kebabCase(key)}`, object[key]);
  };
  const sidebarBaseRgb = hexToRgb(s.muted);
  const sidebarAccentRgb = hexToRgb(s.subtle);
  const sidebarBorderRgb = hexToRgb(i.border);
  const isDark = theme.metadata.variant === 'dark';
  for (const [key, value] of [
    ['background', s.background], ['foreground', s.foreground],
    ['muted', s.muted], ['muted-foreground', s.mutedForeground],
    ['card', s.elevated], ['card-foreground', s.elevatedForeground],
    ['popover', s.elevated], ['popover-foreground', s.elevatedForeground],
    ['border', i.border], ['input', i.border],
    ['primary', p.base], ['primary-foreground', p.foreground],
    ['secondary', s.muted], ['secondary-foreground', s.foreground],
    ['accent', s.subtle], ['accent-foreground', s.foreground],
    ['destructive', st.error], ['destructive-foreground', st.errorForeground], ['ring', i.focusRing],
    ['sidebar-base', s.muted], ['sidebar-base-rgb', sidebarBaseRgb], ['sidebar', 'var(--sidebar-base)'],
    ['sidebar-foreground', s.mutedForeground], ['sidebar-primary', p.base], ['sidebar-primary-foreground', p.foreground],
    ['sidebar-accent-base', s.subtle], ['sidebar-accent-base-rgb', sidebarAccentRgb], ['sidebar-accent', 'var(--sidebar-accent-base)'],
    ['sidebar-accent-foreground', s.foreground], ['sidebar-border', i.border], ['sidebar-border-rgb', sidebarBorderRgb], ['sidebar-ring', i.focusRing],
  ]) if (value !== null) add(key, value, true);
  for (const [key, alpha] of [['strong', isDark ? 0.15 : 0.5], ['soft', isDark ? 0.1 : 0.3]]) {
    add(`sidebar-overlay-${key}`, sidebarBaseRgb ? `rgb(${sidebarBaseRgb} / ${alpha})` : withOpacity(s.muted, alpha), true);
  }
  add('loading-spinner', p.base);
  add('loading-spinner-track', s.muted);
  add('primary-base', p.base);
  add('primary-hover', p.hover || darken(p.base, 10));
  add('primary-active', p.active || darken(p.base, 20));
  add('primary-foreground', p.foreground || '#ffffff');
  add('primary-muted', p.muted || withOpacity(p.base, 0.5));
  group('surface', s, ['background', 'foreground', 'muted', 'mutedForeground', 'elevated', 'elevatedForeground', 'overlay', 'subtle']);
  group('interactive', i, ['border', 'borderHover', 'borderFocus', 'selection', 'selectionForeground', 'focus', 'focusRing', 'cursor', 'hover', 'active']);
  for (const key of STATUS_KEYS) group('status', st, [key, `${key}Foreground`, `${key}Background`, `${key}Border`]);
  for (const [key, fallback] of Object.entries({ open: st.success, draft: s.mutedForeground, blocked: st.warning, merged: isDark ? '#8957e5' : '#8250df', closed: st.error })) {
    add(`pr-${key}`, pr?.[key] || fallback);
  }
  group('syntax', syntax.base, ['background', 'foreground', ...SYNTAX_BASE_KEYS]);
  add('syntax-line-number', syntax.highlights?.lineNumber ?? syntax.base.comment);
  for (const [key, value] of Object.entries(resolveSyntaxTokens(syntax))) add(`syntax-${kebabCase(key)}`, value);
  const m = c.markdown ?? {};
  for (const [key, value] of [
    ['link', m.link || p.base],
    ['link-hover', m.linkHover || p.hover || darken(p.base, 10)],
    ['inline-code', m.inlineCode || syntax.base.string],
    ['inline-code-bg', m.inlineCodeBackground || c.chat?.background || s.background],
    ['blockquote', m.blockquote || s.mutedForeground],
    ['blockquote-border', m.blockquoteBorder || i.border],
    ['list-marker', m.listMarker || withOpacity(p.base, 0.6)],
    ['bold', m.bold || s.foreground],
    ['italic', m.italic || withOpacity(s.foreground, 0.9)],
    ['strikethrough', m.strikethrough || s.mutedForeground],
    ['hr', m.hr || i.border],
  ]) add(`markdown-${key}`, value);
  add('chat-user-message-bg', c.chat?.userMessageBackground ?? s.elevated);
  add('chat-divider', c.chat?.divider ?? i.border);
  for (const [key, value] of [
    ['border', c.tools?.border || withOpacity(i.border, 0.3)],
    ['icon', c.tools?.icon || s.mutedForeground],
    ['title', c.tools?.title || s.foreground],
    ['description', c.tools?.description || withOpacity(s.mutedForeground, 0.6)],
    ['edit-added-bg', c.tools?.edit?.addedBackground || st.successBackground],
    ['edit-removed-bg', c.tools?.edit?.removedBackground || st.errorBackground],
    ['edit-modified-bg', c.tools?.edit?.modifiedBackground || st.infoBackground],
    ['edit-line-number', c.tools?.edit?.lineNumber || withOpacity(s.mutedForeground, 0.6)],
  ]) add(`tools-${key}`, value);
  const readable = getReadableThemeColors(theme);
  for (const [key, value] of Object.entries(readable.tinted)) add(`${key}-text`, value);
  for (const [key, value] of Object.entries(readable.status)) add(`status-${key}-text`, value);
  add('interactive-selection-foreground', readable.selectionForeground);
  addTypography(add, comment, vscode);
  for (const key of ['sans', 'mono', 'heading']) {
    const value = theme.config?.fonts?.[key];
    if (value) {
      add(`font-${key}`, value);
      if (key !== 'heading') add(`font-family-${key}`, value);
    }
  }
  for (const key of ['fast', 'normal', 'slow']) {
    const value = theme.config?.transitions?.[key];
    if (value) add(`transition-${key}`, value);
  }
}

/**
 * Exact upstream declarations for an already parsed theme, for comparison.
 * Do not inject the string into any document: imported syntax record keys are
 * open-ended upstream. For isolated previews, use the name-filtered map below.
 */
export function generateThemeCss(theme, options) {
  const lines = [];
  generateDeclarations(theme, options, (key, value, important) => {
    lines.push(`  ${key}: ${value}${important ? ' !important' : ''};`);
  }, (text) => lines.push(`  /* ${text} */`));
  return lines.join('\n');
}

/** Name-filtered variable map after generated declaration order (not the host cascade); accepts a parsed theme. */
export function themeToCssVariables(theme, options) {
  const values = Object.create(null);
  const importantKeys = new Set();
  generateDeclarations(theme, options, (key, value, important) => {
    // The original CSS writer permits this suffix in legacy fonts/transitions.
    // In a variable map it is a priority marker, not part of the CSS value.
    const trailingPriority = /\s*!\s*important\s*$/i;
    if (trailingPriority.test(value)) {
      value = value.replace(trailingPriority, '');
      important = true;
    }
    if (!/^--[a-z0-9_-]+$/.test(key) || (importantKeys.has(key) && !important)) return;
    values[key] = value;
    if (important) importantKeys.add(key);
  });
  return { ...values };
}
