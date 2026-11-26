import { BASE_SYNTAX } from './theme-derive-audit.mjs';
import { hex, lch, rgb, swatch } from './theme-derive-color.mjs';
import { anchor, pairing, pigment } from './style-recipes-pairings.mjs';

const alpha = (value, byte) => hex({ ...rgb(value), a: byte / 255 });
const gray = (l) => swatch(l, 0, 0);
const color = (dark, pale, night) => dark ? night : pale;
const tokenRoles = (values) => Object.fromEntries(BASE_SYNTAX.map((key, i) => [key, values[i]]));
// This is the material, not the source palette. A rail is made from the
// same mix of pigments as the canvas, with an independent value step.
const material = (l, c = 0, h = 0) => ({
  page: swatch(l, c, h),
  lift: (step, chroma = c) => swatch(l + step, chroma, h),
});

// Each builder designs its own relationships. Common status tags are added
// separately so, for example, an e-ink theme still distinguishes warnings.
function brutal(model, options) {
  const { dark } = model, mark = anchor(model);
  const [bubble, selected, marker] = pairing(mark.family, 'hard', options.palettePair, false, dark);
  const page = color(dark, '#fcfbf8', '#0e0e0e'), ink = color(dark, '#020202', '#fafafa');
  const line = options.edge === 'pigment' ? color(dark, '#182033', '#edf5ff') : ink;
  const signal = color(dark, '#1349a8', '#78bbff');
  const diffAdd = swatch(dark ? 0.337 : 0.881, 0.132, 153);
  const diffRemove = swatch(dark ? 0.386 : 0.823, 0.128, 27);
  // The high-chroma blocks are small. The selected row keeps its normal
  // text polarity because its timestamps and state marks cannot invert.
  return {
    surface: {
      background: page, muted: page, elevated: color(dark, '#f7f7f6', '#1c1c1c'), subtle: color(dark, '#eeeeec', '#252525'),
      foreground: ink, mutedForeground: color(dark, '#303030', '#dddddd'), overlay: page,
    },
    primary: { base: mark.color, foreground: page },
    interactive: {
      border: line, borderHover: line, focusRing: signal,
      selection: pigment(selected, dark),
      selectionForeground: ink, hover: color(dark, '#eaeaea', '#242424'), active: pigment(selected, dark),
    },
    chat: { userMessageBackground: pigment(bubble, dark), divider: line },
    markdown: { link: mark.color, linkHover: signal, inlineCode: color(dark, '#111111', '#fafafa'),
      // Markdown actually halves the alpha of this fill. In the dark layout
      // use a cool saturated chip with light ink, not yellow diluted to mud.
      inlineCodeBackground: dark ? pigment(selected === 'current' ? 'cobalt' : selected, true) : pigment(marker, false),
      blockquoteBorder: line, hr: line },
    syntax: { base: { background: page, foreground: ink, ...tokenRoles(dark
      ? ['#aab2bc', '#86bbff', '#81dcac', '#ffa07f', '#eaeaea', '#fafafa', '#ffb2cb', '#ccd6fd']
      : ['#545d69', '#1645a1', '#126138', '#8a2635', '#151515', '#0a0a0a', '#5c3193', '#263f68']) },
    highlights: { diffAddedBackground: diffAdd, diffRemovedBackground: diffRemove } },
    tools: { border: line, edit: { addedBackground: diffAdd, removedBackground: diffRemove } },
  };
}

function fauve(model, options) {
  const { dark } = model, accent = anchor(model), [panel, dab] = pairing(accent.family, 'paint', options.palettePair, options.pair === 'split', dark);
  const paper = color(dark, '#f7f6f1', '#191d23'), chalk = color(dark, '#282724', '#f3f2ea');
  // One painted panel, not a uniform tint. Slightly darker pigment on the
  // line and lighter chalk in the code give it the feel of a colour study.
  const rail = pigment(panel, dark, { tone: dark ? 0.437 : 0.863, chroma: dark ? 0.122 : 0.124 });
  const edge = pigment(panel, dark, { tone: dark ? 0.691 : 0.487, chroma: 0.119 });
  const lightMark = pigment(dab, dark, { tone: dark ? 0.343 : 0.867, chroma: 0.044 });
  const brush = dark ? '#eeb4ac' : '#94374b', ink = dark ? '#e7dcb0' : '#5e307a';
  return {
    surface: { background: paper, muted: rail, elevated: color(dark, '#f4f3ee', '#242523'),
      foreground: chalk, mutedForeground: color(dark, '#484644', '#ddd9cb'), subtle: lightMark },
    primary: { base: accent.color },
    interactive: { border: edge, focusRing: accent.color, selection: lightMark, hover: color(dark, '#eae5d6', '#2c2b25') },
    chat: { userMessageBackground: color(dark, '#f9f3dd', '#292925') },
    markdown: { link: accent.color, linkHover: brush, inlineCode: ink, inlineCodeBackground: color(dark, '#f0e8d7', '#302d2a'), blockquoteBorder: edge },
    syntax: { base: { background: color(dark, '#ecebe4', '#2d2e2a'), foreground: chalk,
      ...tokenRoles([color(dark, '#53524b', '#bbbbad'), brush, color(dark, '#2b664e', '#83c7ab'), ink,
        color(dark, '#244f9a', '#92bafe'), accent.color, brush, color(dark, '#293c53', '#cedcf2')]) },
      highlights: {
        diffAddedBackground: color(dark, '#e1eee4', '#25342d'), diffRemovedBackground: color(dark, '#eee3dc', '#372a28'),
      } },
    tools: { border: edge, icon: accent.color },
  };
}

function terminal(model, { phosphor }) {
  const { dark } = model, amber = phosphor === 'amber', mark = anchor(model, amber ? 'terminalAmber' : 'terminalGreen');
  const warm = amber ? 85 : 153;
  const deck = material(dark ? 0.164 : 0.989, dark ? amber ? 0.006 : 0.016 : 0.006, warm);
  const ink = amber ? color(dark, '#262321', '#f5d992') : color(dark, '#173425', '#cbe8d4');
  const tones = (dark ? [0.635, 0.884, 0.740, 0.69, 0.825, 0.77, 0.875, 0.925]
    : [0.518, 0.330, 0.455, 0.410, 0.361, 0.481, 0.390, 0.300]).map((l, i) =>
    swatch(l, dark ? 0.072 + 0.02 * (i % 3) : amber ? 0.010 : 0.046 + 0.01 * (i % 3), warm));
  const printed = amber && !dark ? swatch(lch(rgb(mark.color)).l, 0.036, 45) : mark.color;
  const pulse = lch(rgb(mark.color));
  const shine = amber
    ? pigment('saffron', dark, { tone: dark ? 0.32 : 0.89 + (pulse.l - 0.43) * 0.18, chroma: dark ? 0.067 : 0.098 })
    : swatch(dark ? 0.305 : 0.892 + (pulse.l - 0.43) * 0.19, dark ? 0.060 : 0.075, pulse.h);
  return {
    surface: { background: deck.page, muted: deck.lift(dark ? 0.036 : -0.039, dark && amber ? 0.008 : 0.013),
      elevated: deck.lift(dark ? 0.071 : -0.027, 0.009),
      foreground: ink, mutedForeground: amber ? color(dark, '#474136', '#dcc389') : color(dark, '#42534a', '#a3c7ae') },
    primary: { base: amber && !dark ? mark.color : printed },
    interactive: {
      border: amber ? color(dark, '#76695d', '#ae8850') : color(dark, '#5a7262', '#5eae7b'),
      focusRing: printed, cursor: mark.color, selection: shine,
      hover: color(dark, '#e9ece6', '#26342b'), active: shine,
    },
    chat: { userMessageBackground: dark ? deck.lift(-0.038) : swatch(0.945, amber ? 0.052 : 0.038, warm) },
    markdown: { link: printed, linkHover: ink, inlineCode: ink,
      inlineCodeBackground: amber ? color(dark, '#f1dfa9', '#362a16') : color(dark, '#dce9de', '#203a2b') },
    syntax: { base: { background: deck.lift(dark ? -0.038 : 0), foreground: ink, ...tokenRoles(tones) } },
    tools: { icon: printed, border: printed, description: ink },
  };
}

const noteInks = {
  graphite: ['#315587', '#ff9f83'], scarlet: ['#3a4d96', '#ff9a75'], ochre: ['#324a83', '#ffb08d'],
  leaf: ['#9b392d', '#f58675'], surf: ['#9b392d', '#f39077'], blue: ['#9e3d2e', '#ff917e'],
  iris: ['#983a28', '#ffa787'], berry: ['#2a587b', '#f39391'],
};
function editorial(model, { paper }) {
  const { dark } = model, news = paper === 'newsprint', ink = anchor(model), pen = noteInks[ink.family][+dark];
  const deck = dark ? material(news ? 0.205 : 0.216, 0.011, 250) : material(news ? 0.960 : 0.971, 0.014, 86);
  const rule = color(dark, '#817d72', '#777f96');
  const text = color(dark, '#282420', '#f7efdf');
  const penHue = lch(rgb(pen)).h;
  const note = swatch(dark ? 0.385 : 0.908, dark ? 0.074 : 0.038, dark ? 31 : penHue < 38 ? 43 : penHue);
  const selection = alpha(pen, dark ? 63 : 48);
  const folio = deck.lift(dark ? 0.060 : -0.053, dark ? 0.013 : 0.012);
  return {
    surface: { background: deck.page, muted: deck.lift(-0.035, 0.013), elevated: deck.lift(dark ? 0.046 : 0.015, 0.008),
      foreground: text, mutedForeground: color(dark, '#56504a', '#c6bbad') },
    primary: { base: ink.color },
    interactive: { border: rule, focusRing: pen, selection },
    chat: { userMessageBackground: note },
    markdown: { link: pen, linkHover: pen, inlineCode: pen, inlineCodeBackground: note, blockquoteBorder: pen, hr: rule },
    syntax: { base: { background: folio, foreground: text,
      ...tokenRoles([color(dark, '#5c5e59', '#bcb6ad'), pen, text, pen, text, text, pen, text]) } },
    tools: { border: alpha(rule, 160), icon: pen },
  };
}

function swiss(model, { accent }) {
  const { dark } = model, press = anchor(model);
  const ink = color(dark, '#181818', '#f3f3f3'), flat = color(dark, '#ffffff', '#0e0e0e');
  const hair = color(dark, '#929292', '#606060'), grayText = color(dark, '#505050', '#bcbcbc');
  const muted = color(dark, '#f5f5f5', '#1a1a1a');
  const mark = press.color;
  const selected = alpha(mark, accent === 'stripe' ? dark ? 106 : 83 : dark ? 78 : 62);
  return {
    surface: { background: flat, muted: flat, elevated: flat, foreground: ink, mutedForeground: grayText, subtle: muted },
    primary: { base: mark },
    interactive: { border: hair, borderHover: hair, focusRing: mark, selection: selected, hover: muted, active: selected },
    chat: { userMessageBackground: flat },
    markdown: { link: mark, linkHover: mark, inlineCode: mark, inlineCodeBackground: flat, blockquoteBorder: hair },
    syntax: { base: { background: flat, foreground: ink,
      ...tokenRoles([grayText, ink, grayText, ink, ink, ink, grayText, ink]) } },
    tools: { border: hair },
  };
}

function eink(model, { ink }) {
  const { dark } = model, mark = anchor(model, 'eink'), warm = ink === 'warm';
  const deck = dark ? material(0.316) : material(0.920, 0.0033, 85);
  const rail = deck.lift(dark ? 0.039 : -0.039), card = color(dark, '#ffffff', '#171717');
  const main = warm ? color(dark, '#28231c', '#f3ecde') : color(dark, '#202020', '#f0f0f0');
  const muted = warm ? color(dark, '#3a352c', '#e2dbce') : color(dark, '#353535', '#dedede');
  const origin = lch(rgb(mark.color)).l;
  const wash = gray((dark ? 0.408 : 0.758) + (origin - (dark ? 0.85 : 0.32)) * 0.41);
  const steps = (dark ? [0.73, 0.956, 0.839, 0.911, 0.875, 0.791, 0.897, 0.98]
    : [0.492, 0.241, 0.432, 0.287, 0.341, 0.387, 0.306, 0.217]).map(gray);
  return {
    surface: { background: deck.page, muted: rail, elevated: card, foreground: main, mutedForeground: muted, subtle: rail },
    primary: { base: mark.color },
    interactive: { border: ink === 'warm' ? main : color(dark, '#272727', '#ededed'), selection: wash, focusRing: main,
      hover: card, active: wash },
    chat: { userMessageBackground: card },
    markdown: { link: mark.color, linkHover: main, inlineCode: main, inlineCodeBackground: wash },
    syntax: { base: { background: card, foreground: main, ...tokenRoles(steps) } },
    tools: { border: main, description: muted, edit: { lineNumber: muted } },
  };
}

const cyberTrack = {
  graphite: ['#4643a9', '#a0c8fa'], scarlet: ['#234cb8', '#8ae4f7'], ochre: ['#2153a0', '#81d9f7'],
  leaf: ['#164f7c', '#86d2ff'], surf: ['#2852b4', '#ac9ff7'], blue: ['#13469d', '#77def2'],
  iris: ['#17528c', '#90d8f5'], berry: ['#234bb3', '#84c9fa'],
};
function cyber(model, { flavor }) {
  const { dark } = model, vapor = flavor === 'vapor', neon = anchor(model, vapor ? 'vapor' : 'cyber');
  const flash = cyberTrack[neon.family][+dark];
  const deck = material(dark ? vapor ? 0.173 : 0.165 : 0.986, dark ? 0.016 : 0.006, dark && vapor ? 274 : 241);
  const type = color(dark, '#182034', '#edf0ff');
  // Keep the workspace near-white or midnight; the e-mail-like transmitted
  // block and small carrier strips hold the electric colours.
  const laser = ['graphite','leaf','blue','iris'].includes(neon.family) ? 215 : 253;
  const activeHue = vapor && neon.family !== 'leaf' ? 303 : laser;
  const rim = swatch(dark ? 0.684 : 0.531, 0.136, laser);
  const chip = swatch(dark ? 0.314 : 0.847, vapor ? 0.066 : 0.082, activeHue);
  const micro = swatch(dark ? 0.262 : 0.918, 0.049, activeHue);
  const message = swatch(dark ? 0.350 : 0.866, vapor ? 0.078 : dark ? 0.107 : 0.080, vapor && neon.family !== 'leaf' ? 282 : laser);
  return {
    surface: { background: deck.page, muted: deck.lift(dark ? 0.028 : -0.027), elevated: deck.lift(dark ? 0.088 : 0.014, 0.011),
      foreground: type, mutedForeground: color(dark, '#414958', '#c1c8de'), subtle: micro },
    primary: { base: neon.color },
    interactive: { border: rim, focusRing: neon.color, selection: chip, hover: micro, active: chip, cursor: flash },
    chat: { userMessageBackground: message },
    markdown: { link: neon.color, linkHover: flash, inlineCode: flash, inlineCodeBackground: micro, blockquoteBorder: flash },
    syntax: { base: { background: deck.lift(dark ? 0.056 : -0.050, 0.010), foreground: type,
      ...tokenRoles([color(dark, '#575b6d', '#9ea4ba'), neon.color, flash, neon.color,
        flash, type, neon.color, flash]) } },
    tools: { border: rim, icon: neon.color },
  };
}

const pixelTints = { graphite: 247, scarlet: 58, ochre: 76, leaf: 148, surf: 190, blue: 252, iris: 291, berry: 52 };
function pixel(model, { palette }) {
  const { dark } = model, signal = anchor(model, 'pixel');
  const warm = ['scarlet','ochre','berry'].includes(signal.family);
  const hue = dark && warm ? 240 : pixelTints[signal.family];
  const deck = material(dark ? 0.191 : 0.969, 0.008, hue);
  const a = deck.page;
  const b = swatch(dark ? 0.371 : 0.821, 0.066, hue);
  const c = swatch(dark ? 0.796 : 0.396, 0.014, hue);
  const d = swatch(dark ? 0.954 : 0.210, 0.014, hue);
  const e = palette === 'six' ? deck.lift(dark ? 0.035 : -0.035) : a;
  const f = palette === 'six' ? swatch(dark ? 0.834 : 0.350, 0.021, hue) : d;
  const p = signal.color;
  return {
    surface: { background: a, muted: e, elevated: b, subtle: e, foreground: d, mutedForeground: c, elevatedForeground: d, overlay: a },
    primary: { base: p, foreground: a },
    interactive: { border: c, borderHover: c, focusRing: p, selection: b, selectionForeground: d, hover: e, active: b, cursor: d },
    chat: { userMessageBackground: b, divider: c },
    markdown: { link: p, linkHover: f, inlineCode: f, inlineCodeBackground: b, blockquote: c, blockquoteBorder: c,
      bold: d, italic: d, strikethrough: c, hr: c },
    syntax: { base: { background: e, foreground: d, ...tokenRoles([c, p, f, p, d, f, p, c]) },
      highlights: { lineNumber: c, lineNumberActive: d } },
    tools: { border: c, icon: p, title: d, description: c, edit: { lineNumber: c, addedBackground: b, removedBackground: b } },
  };
}

const glassUndertone = { graphite: 242, scarlet: 220, ochre: 249, leaf: 160, surf: 199, blue: 250, iris: 286, berry: 266 };
function glass(model, { glass }) {
  const { dark } = model, mist = anchor(model, 'glass');
  const tinted = glass === 'tint', dew = glassUndertone[mist.family];
  const deck = material(dark ? 0.277 : 0.933, tinted ? 0.010 : 0.008, dew);
  const edge = swatch(dark ? 0.648 : 0.540, 0.022, dew);
  const shine = dark ? deck.lift(0.151, 0.017) : '#ffffff', ink = color(dark, '#293743', '#e4edf4');
  const weak = color(dark, '#495764', '#d1dce5');
  const signature = lch(rgb(mist.color));
  const tint = swatch(dark ? 0.431 : 0.837, tinted ? 0.069 : 0.052, signature.h < 41 ? 48 : signature.h);
  return {
    surface: { background: deck.page, muted: deck.lift(0.040),
      elevated: alpha(shine, 175), subtle: alpha(deck.lift(dark ? 0.101 : 0.058, 0.010), 196),
      foreground: ink, mutedForeground: weak },
    primary: { base: mist.color },
    interactive: { border: edge, focusRing: mist.color,
      selection: alpha(mist.color, dark ? 76 : 66),
      hover: alpha(edge, 27), active: alpha(edge, 55) },
    chat: { userMessageBackground: alpha(tint, 151) },
    markdown: { link: mist.color, linkHover: ink, inlineCode: ink, inlineCodeBackground: alpha(edge, 35) },
    syntax: { base: { background: alpha(deck.lift(dark ? 0.112 : 0.034, 0.010), 147), foreground: ink,
      ...tokenRoles([weak, mist.color, color(dark, '#355b50', '#9cc8b6'), ink, mist.color, weak, mist.color, ink]) } },
    tools: { border: alpha(edge, 128), icon: mist.color },
  };
}

export const DESIGNS = {
  brutalism: brutal,
  fauvism: fauve,
  'terminal-retro': terminal,
  'editorial-paper': editorial,
  'swiss-minimal': swiss,
  eink,
  'cyber-vapor': cyber,
  'pixel-palette': pixel,
  'soft-glass': glass,
};
