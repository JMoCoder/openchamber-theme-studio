import { angleGap, hex, lch, rgb, swatch } from './theme-derive-color.mjs';

// The keys describe palette lineage, not arbitrary offsets from a hue.
// Each swatch is intentionally assigned to a light/dark treatment and a role.
const INKS = {
  graphite: { hue: 250, light: ['#434852', '#28333e'], dark: ['#a6b2c4', '#ccd5e2'] },
  scarlet: { hue: 27, light: ['#a72b2e', '#8d1722'], dark: ['#ff8689', '#ff9b8c'] },
  ochre: { hue: 84, light: ['#95401c', '#732a19'], dark: ['#e0ad63', '#f9c77a'] },
  leaf: { hue: 151, light: ['#17613f', '#07502e'], dark: ['#59c692', '#81e2a8'] },
  surf: { hue: 190, light: ['#09606a', '#004558'], dark: ['#54c6d0', '#88e4e6'] },
  blue: { hue: 247, light: ['#1d55a6', '#023d8c'], dark: ['#8faef9', '#a3c5ff'] },
  iris: { hue: 295, light: ['#5c40a5', '#472882'], dark: ['#b5a0fc', '#c1acff'] },
  berry: { hue: 332, light: ['#8b355d', '#732149'], dark: ['#e58cbe', '#ffa6d4'] },
};

// Separate colour ways for styles whose age, material or output medium
// deliberately changes how much of the original hue survives.
const PER_STYLE = {
  eink: {
    graphite: ['#212121', '#ededed'], scarlet: ['#343434', '#cecece'], ochre: ['#434343', '#d5d5d5'],
    leaf: ['#505050', '#bcbcbc'], surf: ['#393939', '#c5c5c5'], blue: ['#2a2a2a', '#dfdfdf'],
    iris: ['#474747', '#d9d9d9'], berry: ['#303030', '#e5e5e5'],
  },
  pixel: {
    graphite: ['#454e62', '#94b9fa'], scarlet: ['#81331e', '#f1a176'], ochre: ['#7c3b17', '#e6b970'],
    leaf: ['#0b5b3c', '#6bd396'], surf: ['#005770', '#63cbdc'], blue: ['#164ba4', '#94baff'],
    iris: ['#5b3693', '#baa6f8'], berry: ['#8d3955', '#ee92b4'],
  },
  glass: {
    graphite: ['#404c61', '#a1b6d4'], scarlet: ['#884b3b', '#d9a089'], ochre: ['#7d492e', '#d6a584'],
    leaf: ['#315945', '#99c7ac'], surf: ['#285964', '#8fbfc8'], blue: ['#365887', '#9cbcf0'],
    iris: ['#624d81', '#bba5d6'], berry: ['#764760', '#d1a0bb'],
  },
  cyber: {
    graphite: ['#303ab6', '#7daaff'], scarlet: ['#b21644', '#ff7295'], ochre: ['#ab3715', '#ffab69'],
    leaf: ['#007053', '#3af1b2'], surf: ['#006784', '#43deec'], blue: ['#2045bf', '#78b4ff'],
    iris: ['#6429b4', '#c49dff'], berry: ['#a60a76', '#fa96e9'],
  },
  vapor: {
    graphite: ['#6644a0', '#b3b2f4'], scarlet: ['#a62858', '#ff90b4'], ochre: ['#943753', '#ffacbf'],
    leaf: ['#24664c', '#75dabc'], surf: ['#215d88', '#8bcfea'], blue: ['#344da0', '#96c0ff'],
    iris: ['#763db3', '#d29dff'], berry: ['#a12779', '#f6a2ea'],
  },
  terminalGreen: {
    graphite: ['#255d3a', '#81e59e'], scarlet: ['#244b31', '#7fd8a1'], ochre: ['#365839', '#a6dc8a'],
    leaf: ['#205a35', '#68e39c'], surf: ['#1e5041', '#6adcb5'], blue: ['#24664b', '#8bdccb'],
    iris: ['#2e5238', '#95da9a'], berry: ['#2a5033', '#9ee3a2'],
  },
  terminalAmber: {
    graphite: ['#725029', '#f5cb79'], scarlet: ['#703f28', '#ffbf78'], ochre: ['#63492d', '#f5d485'],
    leaf: ['#654a2c', '#ead57e'], surf: ['#624530', '#e9c283'], blue: ['#594435', '#f4bd75'],
    iris: ['#65432e', '#f2cf90'], berry: ['#6d4230', '#f7c286'],
  },
};

// Matte pigments, not generic complements. A pigment belongs to a named
// palette family and comes with two independent value recipes. Saturation
// is held on small, useful marks or the single painted panel.
const PIGMENTS = {
  acid:     { h: 116, c: 0.203, light: 0.872, dark: 0.365 },
  wasabi:   { h: 128, c: 0.168, light: 0.864, dark: 0.365 },
  saffron:  { h: 94,  c: 0.175, light: 0.860, dark: 0.363 },
  marigold: { h: 77,  c: 0.168, light: 0.847, dark: 0.374 },
  rust:     { h: 41,  c: 0.169, light: 0.797, dark: 0.360 },
  tomato:   { h: 29,  c: 0.192, light: 0.816, dark: 0.357 },
  lagoon:   { h: 184, c: 0.155, light: 0.846, dark: 0.370 },
  electric: { h: 207, c: 0.162, light: 0.845, dark: 0.351 },
  denim:    { h: 255, c: 0.174, light: 0.799, dark: 0.345 },
  iris:     { h: 289, c: 0.176, light: 0.797, dark: 0.362 },
  brick:    { h: 51,  c: 0.124, light: 0.819, dark: 0.364 },
  inkblue:  { h: 250, c: 0.133, light: 0.820, dark: 0.351 },
  cobalt:   { h: 262, c: 0.255, light: 0.821, dark: 0.478 },
  claret:   { h: 16,  c: 0.226, light: 0.833, dark: 0.475 },
  emerald:  { h: 161, c: 0.214, light: 0.857, dark: 0.463 },
  current:  { h: 205, c: 0.181, light: 0.851, dark: 0.466 },
  ultraviolet: { h: 285, c: 0.253, light: 0.823, dark: 0.470 },
};

const HARD_NIGHT = {
  graphite: { auto: ['cobalt','emerald','acid'], signal: ['current','cobalt','saffron'], studio: ['claret','cobalt','marigold'], triad: ['ultraviolet','cobalt','saffron'] },
  scarlet: { auto: ['claret','cobalt','electric'], signal: ['cobalt','current','acid'], studio: ['claret','cobalt','saffron'], triad: ['cobalt','claret','marigold'] },
  ochre: { auto: ['cobalt','claret','saffron'], signal: ['cobalt','current','marigold'], studio: ['claret','cobalt','brick'], triad: ['claret','cobalt','marigold'] },
  leaf: { auto: ['cobalt','current','acid'], signal: ['emerald','cobalt','electric'], studio: ['cobalt','emerald','marigold'], triad: ['cobalt','claret','saffron'] },
  surf: { auto: ['cobalt','claret','electric'], signal: ['current','cobalt','marigold'], studio: ['claret','cobalt','saffron'], triad: ['claret','cobalt','marigold'] },
  blue: { auto: ['cobalt','emerald','saffron'], signal: ['emerald','cobalt','marigold'], studio: ['claret','cobalt','saffron'], triad: ['claret','current','marigold'] },
  iris: { auto: ['ultraviolet','cobalt','saffron'], signal: ['current','cobalt','iris'], studio: ['claret','cobalt','saffron'], triad: ['cobalt','claret','marigold'] },
  berry: { auto: ['claret','cobalt','electric'], signal: ['current','claret','electric'], studio: ['claret','cobalt','marigold'], triad: ['cobalt','claret','saffron'] },
};

// Green and lavender never share a panel. The night paintings also leave
// warm earthy pigments for small marks instead of darkening them to brown.
const NIGHT_PANEL = {
  acid: 'lagoon', wasabi: 'lagoon', saffron: 'electric', marigold: 'lagoon',
  rust: 'denim', tomato: 'inkblue', brick: 'electric',
};
const DAY_PANEL = { tomato: 'rust' };
const NIGHT_PAINT_AUTO = {
  graphite: 'iris', scarlet: 'denim', ochre: 'iris', leaf: 'electric',
  surf: 'denim', blue: 'lagoon', iris: 'electric', berry: 'iris',
};

// [message, selected row, inline code] for hard printed marks.
const HARD = {
  graphite: { auto: ['electric','acid','saffron'], signal: ['acid','electric','denim'], studio: ['marigold','inkblue','brick'], triad: ['denim','saffron','tomato'] },
  scarlet: { auto: ['electric','marigold','denim'], signal: ['electric','acid','tomato'], studio: ['inkblue','brick','saffron'], triad: ['denim','tomato','saffron'] },
  ochre: { auto: ['denim','acid','saffron'], signal: ['electric','acid','marigold'], studio: ['inkblue','saffron','brick'], triad: ['tomato','denim','saffron'] },
  leaf: { auto: ['saffron','electric','acid'], signal: ['acid','electric','saffron'], studio: ['marigold','inkblue','brick'], triad: ['denim','tomato','saffron'] },
  surf: { auto: ['marigold','acid','electric'], signal: ['acid','electric','saffron'], studio: ['brick','inkblue','marigold'], triad: ['tomato','denim','marigold'] },
  blue: { auto: ['electric','saffron','acid'], signal: ['acid','electric','marigold'], studio: ['brick','saffron','inkblue'], triad: ['tomato','electric','saffron'] },
  iris: { auto: ['electric','saffron','iris'], signal: ['electric','marigold','iris'], studio: ['brick','inkblue','saffron'], triad: ['tomato','denim','marigold'] },
  berry: { auto: ['denim','saffron','electric'], signal: ['electric','saffron','iris'], studio: ['inkblue','brick','marigold'], triad: ['tomato','denim','saffron'] },
};

// Each pair has one full panel pigment and a separate small mark.
const PAINT = {
  graphite: { auto: ['lagoon','marigold'], signal: ['electric','acid'], studio: ['brick','inkblue'], triad: ['denim','tomato'] },
  scarlet: { auto: ['electric','saffron'], signal: ['lagoon','acid'], studio: ['brick','inkblue'], triad: ['denim','marigold'] },
  ochre: { auto: ['denim','saffron'], signal: ['electric','acid'], studio: ['inkblue','brick'], triad: ['tomato','electric'] },
  leaf: { auto: ['marigold','inkblue'], signal: ['saffron','electric'], studio: ['brick','denim'], triad: ['denim','marigold'] },
  surf: { auto: ['rust','saffron'], signal: ['acid','electric'], studio: ['brick','inkblue'], triad: ['tomato','denim'] },
  blue: { auto: ['marigold','denim'], signal: ['acid','electric'], studio: ['brick','inkblue'], triad: ['tomato','saffron'] },
  iris: { auto: ['electric','saffron'], signal: ['denim','marigold'], studio: ['brick','iris'], triad: ['tomato','denim'] },
  berry: { auto: ['denim','saffron'], signal: ['electric','marigold'], studio: ['brick','inkblue'], triad: ['tomato','denim'] },
};

export function pigment(id, dark, { tone, chroma, alpha = 1 } = {}) {
  const p = PIGMENTS[id];
  return swatch(tone ?? p[dark ? 'dark' : 'light'], chroma ?? p.c, p.h, alpha);
}

const hueNames = Object.entries(INKS).filter(([name]) => name !== 'graphite');
const inksByFinish = new Map();
function hueFamily(color) {
  if (!color) return 'graphite';
  const tone = lch(color);
  if (tone.c < 0.041) return 'graphite';
  return [...hueNames].sort(([, x], [, y]) => angleGap(x.hue, tone.h) - angleGap(y.hue, tone.h))[0][0];
}

function finishedInks(kind, dark) {
  const key = `${kind}:${dark}`;
  if (inksByFinish.has(key)) return inksByFinish.get(key);
  const profile = PER_STYLE[kind];
  const steps = dark ? [0, 0.020, 0.041, 0.056, 0.012] : [0, -0.016, -0.033, -0.047, -0.024];
  const inks = Object.entries(INKS).map(([family, source]) => {
    const v = dark ? 'dark' : 'light';
    const first = profile?.[family][+dark] ?? source[v][0];
    const { l, c, h } = lch(rgb(first));
    const values = steps.map((step, i) => i ? swatch(l + step, c * (i === 2 ? 1.03 : 1), h) : first);
    return { family, hue: source.hue, values, prior: profile ? [] : source[v].slice(1) };
  });
  inksByFinish.set(key, inks);
  return inks;
}

export function anchor(model, kind = 'common') {
  const dark = model.dark;
  const input = model.color('primary.base') ?? model.canvas;
  const inks = finishedInks(kind, dark), existing = input ? hex(input) : null;
  const exact = existing && inks.find(({ values, prior }) => values.includes(existing) || prior.includes(existing));
  if (exact) return { family: exact.family, color: existing, hue: exact.hue };
  const family = hueFamily(input);
  const { values, hue } = inks.find((ink) => ink.family === family);
  const tone = lch(input ?? rgb(dark ? '#a6b2c4' : '#434852'));
  // The original lightness/chroma leaves a trace in the ink, never in the
  // paper. Azure, navy and vivid cobalt can share a family without merging.
  const finish = family === 'graphite' ? 0 : (dark ? tone.l > 0.859 : tone.l < 0.381) ? 3 : tone.c > 0.162 ? 2
    : (dark ? tone.l < 0.739 : tone.l < 0.448) ? 1 : family === 'surf' && tone.h < 214 ? 4 : 0;
  return { family, color: values[finish], hue };
}

export function pairing(family, kind, mode = 'auto', split = false, dark = false) {
  const spec = (kind === 'hard' ? dark ? HARD_NIGHT : HARD : PAINT)[family];
  const key = split && mode === 'auto' ? 'triad' : mode;
  const colors = spec[key] ?? spec.auto;
  if (kind !== 'paint') return colors;
  const panels = dark ? NIGHT_PANEL : DAY_PANEL;
  return [dark && key === 'auto' ? NIGHT_PAINT_AUTO[family] : panels[colors[0]] ?? colors[0], colors[1]];
}
