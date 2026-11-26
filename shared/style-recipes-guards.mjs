import { BASE_SYNTAX, view } from './theme-derive-audit.mjs';
import { angleGap, delta, hex, lab, lch, ratio, rgb } from './theme-derive-color.mjs';
import { isMaterial, materialFinishFailures, materialSurfaceFailures } from './style-recipes-materials.mjs';

// Nearest-rank P90 of rendered colours in 31 + 31 native v2.8.0 themes.
// Keep the precision used by the tests; round only in the documentation.
export const STOCK_P90 = {
  light: { canvas: 0.0153209059, muted: 0.0149659550, elevated: 0.0165593361 },
  dark: { canvas: 0.0264245281, muted: 0.0222712817, elevated: 0.0254168631 },
};
const CAN_PAINT = { fauvism: 'muted', 'pixel-palette': 'elevated' };
const PRIMARY_ROLES = ['primary.base', 'markdown.link', 'markdown.linkHover'];
const TEXTS = [
  'surface.foreground', 'surface.mutedForeground', 'surface.elevatedForeground', 'primary.foreground', 'interactive.selectionForeground',
  'markdown.link', 'markdown.linkHover', 'markdown.inlineCode', 'markdown.blockquote', 'markdown.bold', 'markdown.italic', 'markdown.strikethrough',
  'tools.title', 'tools.description', 'tools.edit.lineNumber', 'syntax.base.foreground',
  ...BASE_SYNTAX.map((key) => `syntax.base.${key}`),
];
const GREEN = ({ c, h }) => c >= 0.025 && h >= 120 && h <= 175;
const LILAC = ({ c, h }) => c >= 0.025 && h >= 280 && h <= 335;
const PINK = ({ l, c, h }) => l > 0.85 && c > 0.015 && (h >= 335 || h <= 30);
const WARM = ({ c, h }) => c > 0.012 && h >= 4 && h <= 117;
const YELLOW_INK = ({ c, h }) => c >= 0.025 && h >= 58 && h <= 115;

/** Actual plotted colours; no recipe IDs used to infer a colour or relationship. */
export function styleGuardrails(definition, id) {
  const model = view(definition), problems = [];
  if (isMaterial(id)) return materialSurfaceFailures(model);
  const tone = (c) => c && lch(c);
  const surfaces = Object.entries(STOCK_P90[model.variant]).map(([name, p90]) => ({ name, p90, tone: tone(model.back(name)) }));
  for (const { name, p90, tone } of surfaces) {
    if (!tone) { problems.push({ code: 'G1', role: name, actual: null }); continue; }
    if (CAN_PAINT[id] !== name && tone.c > p90 + 0.00002) problems.push({ code: 'G1', role: name, actual: tone.c, maximum: p90 });
  }
  const roles = [...surfaces, ...['code','bubble','selection','selectedSidebar','selectedCard'].map((name) => ({ name, tone: tone(model.back(name)) }))];
  const pigments = PRIMARY_ROLES.map((name) => tone(model.color(name))).filter(Boolean);
  const hasGreen = pigments.some(GREEN), hasLilac = pigments.some(LILAC);
  for (const { name, tone } of roles) {
    if (!tone) continue;
    if (hasGreen && LILAC(tone) || hasLilac && GREEN(tone) ||
      !model.dark && ['canvas','muted','elevated','code'].includes(name) && PINK(tone)) problems.push({ code: 'G2', role: name, actual: tone });
    if (model.dark && ['canvas','muted','elevated','code'].includes(name) && WARM(tone)) problems.push({ code: 'warm-dark-plane', role: name, actual: tone });
  }
  if (!model.dark) {
    // Warning/status marks are semantic symbols, not ink for prose or code.
    for (const name of TEXTS) {
      const t = tone(model.color(name));
      if (t && YELLOW_INK(t)) problems.push({ code: 'G4', role: name, actual: t });
    }
  }
  return problems;
}

function depth(front, back, dark) {
  const f = lch(front), b = lch(back), dL = (f.l - b.l) * (dark ? 1 : -1);
  if (f.c >= 0.042 && delta(lab(front), lab(back)) >= 0.065) return 'paint';
  if (dL <= -0.034) return 'recess';
  if (dL < -0.013) return 'light-inset';
  if (dL >= 0.104) return 'tier';
  if (dL >= 0.043) return 'step';
  if (dL >= 0.013) return 'shallow';
  return 'flat';
}

/** The full-strength paper/rail relationship, measured on the RGB actually emitted. */
export function materialGuardrails(definition, id) {
  const model = view(definition);
  if (isMaterial(id)) return materialFinishFailures(model, id);
  const page = lch(model.canvas), rail = lch(model.back('muted'));
  const problems = [];
  const deltaL = Math.abs(page.l - rail.l);
  if (id !== 'fauvism' && hex(model.canvas) !== hex(model.back('muted'))) {
    if (deltaL < 0.012 || deltaL > 0.045) problems.push({ code: 'rail-step', deltaL });
    if (Math.min(page.c, rail.c) >= 0.006 && angleGap(page.h, rail.h) > 23) {
      problems.push({ code: 'rail-temperature', page: page.h, rail: rail.h });
    }
  }
  if (id === 'swiss-minimal' && (page.c > 0.005 || (model.dark ? page.l > 0.20 : page.l < 0.985))) {
    problems.push({ code: 'swiss-stock', page });
  }
  if (id === 'eink' && [page, rail, lch(model.back('elevated'))].some(({ c }) => c > 0.005)) {
    problems.push({ code: 'eink-stock', page, rail });
  }
  if (id === 'soft-glass' && (page.c > 0.012 || rail.l <= page.l || model.color('surface.elevated').a >= 1)) {
    problems.push({ code: 'fog-stock', page, rail });
  }
  const editor = lch(model.back('code'));
  if (editor.c > 0.027) problems.push({ code: 'file-editor-stock', editor });
  return problems;
}

export const SIGNATURE_AXES = ['sidebar', 'edge', 'bubble', 'code', 'selection', 'syntax', 'accent'];
export function structuralSignature(definition) {
  const model = view(definition), { dark, canvas } = model;
  const source = (path) => model.color(path);
  const border = source('interactive.border'), boundary = ratio(border, canvas);
  const fill = model.back('bubble'), selection = model.back('selection');
  const side = lch(model.back('muted')), edge = lch(border);
  const base = source('primary.base'), signal = lch(base);
  const tokens = BASE_SYNTAX.map((key) => source(`syntax.base.${key}`));
  const roles = tokens.map((c) => lch(c));
  const unique = new Set(tokens.map(hex)).size;
  const strong = roles.filter(({ c }) => c > 0.029);
  const sameInk = strong.length < 2 || strong.every(({ h }) => angleGap(h, strong[0].h) <= 28);
  const accent = [
    ...tokens, border, source('interactive.focusRing'), source('markdown.link'), source('markdown.linkHover'),
    model.back('muted'), fill, selection, model.back('inline'),
  ].filter((c) => {
    const tint = lch(c);
    return tint.c >= 0.044 && signal.c >= 0.044 && angleGap(tint.h, signal.h) <= 24;
  }).length;
  const layered = (c, fill, back = canvas) => c.a < 0.96 ? 'translucent' : depth(fill, back, dark);
  return {
    sidebar: depth(model.back('muted'), canvas, dark),
    edge: side.c > 0.058 && edge.c > 0.042 && angleGap(side.h, edge.h) <= 24 ? 'matching-pigment'
      : boundary >= 11 ? 'ink' : edge.c >= 0.053 ? 'pigment' : boundary >= 4.4 ? 'firm' : 'hairline',
    bubble: layered(source('chat.userMessageBackground'), fill),
    code: layered(source('syntax.base.background'), model.back('code')),
    selection: hex(source('interactive.selection')) === hex(source('chat.userMessageBackground')) ? 'shared-fill'
      : layered(source('interactive.selection'), selection),
    syntax: strong.length === 0 ? unique > 5 ? 'ink-ramp' : 'gray' : sameInk ? unique > 5 ? 'phosphor' : 'signal'
      : unique <= 5 ? 'two-ink' : unique === 6 ? 'three-ink' : 'spectrum',
    accent: accent <= 2 ? 'small' : accent <= 5 ? 'punctuation' : 'thread',
  };
}
