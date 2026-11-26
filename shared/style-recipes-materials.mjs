import { BASE_SYNTAX } from './theme-derive-audit.mjs';
import { black, blend, delta, fit, fromLch, hex, lab, lch, light, over, ratio, rgb, white } from './theme-derive-color.mjs';

// Canvas / rail / chat card / bubble / selected row / rule / ordinary ink /
// small ink / inline code wash / file paper / link ink. Separate day and night
// compositions, not inversions. The second list of inks follows BASE_SYNTAX.
const materials = {
  constructivist: {
    light: ['efe8d9 e35125 f0efea e4e2dc ddcfb3 100d0b 0c0a09 1d1512 e5e2d9 f9f7ee 761b16', '595c64 97190e 4e321b 4b1620 100d0c 342d28 7a1b14 514640'],
    dark: ['18181a 911f1a 303032 393634 6b3029 f5664c fff0d5 eaddc5 43352d 242426 ffa28b', 'a5a9a9 ff927b f1d097 e3e2e0 fffaf0 d3c8b4 f6aa93 bea39a'],
    alt: [{ 1: 'd9ae92', 2: 'e58966', 3: 'e8e3d6', 4: 'd9c495' }, { 1: '443631', 2: '74322a', 3: '41352e', 4: '813a2e' }],
  },
  'art-deco': {
    light: ['fff8e8 c7ad71 f4ecda d0e5d1 ccab53 514224 221d15 504226 d9e7d4 f1ede1 235a43', '5f5a4f 653807 07583e 74252a 18314e 373529 475625 665332'],
    dark: ['191b17 1b5046 29352e 4f4b28 69613a c6a86b f3e9cd e5d8b8 394334 20251d 9cdbb9', 'abb8a9 ffd67a 82ddb2 f0a382 9fcbe4 e8dfcd b6c68d d3be92'],
    alt: [{ 1: 'c6a078', 3: 'dce6c5', 4: 'c6a97a' }, { 1: '304a31', 3: '604332', 4: '74553d', 5: 'd4a77e' }],
  },
  'mineral-landscape': {
    light: ['e7dbc4 7fa6d0 b3d1c2 6fb49a 8cb1a3 32555f 122a2a 243c38 a4c4bc e7e5d5 265367', '585950 224978 22543b 7e3416 113033 233b34 574f2d 42584f'],
    dark: ['254d5d 285546 304c52 365b4b 50715a c0a874 f3ead1 e3dfcc 415d56 203e47 a7dae4', 'a1bbb6 7ad5ff 8ee3a5 f9cc71 f0a37d d2e8dc b8dec5 9dc9ce'],
    alt: [{ 1: '68ad98', 2: 'aebfdb', 3: '9eb89b', 4: '8caab1' }, { 0: '254754', 1: '37614a', 2: '344758', 3: '456450', 4: '587456' }],
  },
  'retro-desktop': {
    light: ['dedfe5 76bcb3 fbfcff fff4a8 92aeda 4c5364 111d28 203846 d3dde9 f5f8fe 143f9f', '4f6256 203997 006343 8c3f00 752752 2d3139 723164 374e79'],
    dark: ['0e1016 142b67 252c40 53521b 4b60a0 bbc7e8 edf0fd d6e3fe 343d5c 131920 a8c3ff', 'a8bca9 93b5ff b8e684 ffdd79 6adce6 e0efff f7a9ce aec9fd'],
    alt: [{ 1: 'a3adce', 3: 'f8e285', 4: '87b8ac' }, { 0: '202533', 1: '3c3367', 4: '536090', 5: 'c9c5e4' }],
  },
  'thermal-ramp': {
    light: ['fef2b0 f3a044 fff2c4 e7782e e5a152 782e22 2b1931 402537 efab62 f9e8af 742739', '6b4f64 81223b 872d12 684a10 39214e 47263f 76422c 704062'],
    dark: ['131d2a 2a404d 642d20 a74913 86401e ff9951 fff2b4 f8dbac 5f3a27 2c213e ffc47c', 'b4a1bd ff9871 ffcb78 ffef9c d8adff f5dccb ffbaaa e3c2db'],
    alt: [{ 0: 'f5d152', 1: 'ef8c38', 2: 'ffdf9b', 3: 'eea141' }, { 0: '22172f', 1: '372b70', 2: '77371c', 3: '8f530d', 4: '85573a' }],
  },
  chalkboard: {
    light: ['bdcfc2 d6bc9c eef0dc edf1e6 8eb1a3 536457 142e29 29453c a9beb0 dde5d9 295e52', '5c5958 1b6870 394d1c 753826 28467c 233f3a 753e35 435d53'],
    dark: ['244337 644532 2a5140 515f41 496e54 a7b59a edf1dc dce9dd 375846 20382f b0dfbd', 'abbeb6 f8d77f 9ce38e f9a6bc 91cef8 e6efde efe2fb c0dac6'],
    alt: [{ 0: 'bdcbd1', 2: 'e6edef', 4: 'a3b8c2', 9: 'd9e4eb' }, { 0: '2d4048', 2: '2e4852', 4: '4e6470', 9: '263c44' }],
  },
  'stained-glass': {
    light: ['e9e5dc 739de8 9ed7b9 f4bd59 e25139 272d33 12232b 25343a b8d9cb d9ebde 22498b', '49635c 24478f 0d583a 87251c 6e4b06 203a45 7a2846 453762'],
    dark: ['212c3a 214d96 15543d 654718 842f29 a7b2c1 fbf4e7 ede1d5 303f58 183d34 b2d3fe', 'aabfbf 85bbff 76dea8 ffaa8b f4cf72 ece9f6 f8dd9c c1d0f8'],
    alt: [{ 2: 'ebce84', 3: '9dd7b6', 4: 'd65d42' }, { 2: '584121', 3: '275840', 4: '8b382e' }],
  },
  'kraft-label': {
    light: ['d9bc8e b69a72 efe2c9 fbf1dc cfa073 573a22 282018 3a2b20 d9ba8e f9ecd4 833c31', '595853 8a3223 3b5530 62470c 2e2b25 3f3529 644b2e 554437'],
    dark: ['252528 73563d 543f2e 82644b 785943 c8a372 faedda f5e4d0 56462f 392f25 f6b4a4', 'a7a29c ff9b79 b5cf85 ebc363 f8e5cc eadbc6 eac49f d8c8b5'],
    alt: [{ 0: 'd2c7a2', 1: 'a8a173', 2: 'e5dfc5', 3: 'f8f3df', 4: 'b6b181' },
      { 0: '282b25', 1: '625f3f', 2: '4d4d32', 3: '646147', 4: '6c6545' }],
  },
};

// Neutral, vermilion, ochre, jade, lapis. The base accent chooses a pigment
// from this recipe's own set; it never repaints the canvas, rail or card.
const pigments = {
  'art-deco': ['d1ccbb d68961 dec47d b6d6b0 a6bfdc', '4f4b28 703c32 594b29 305e45 344f73'],
  'mineral-landscape': ['6fb49a d78a64 e0bf69 65aa8b 83acd5', '365b4b 6b3b31 62522c 466a45 2b5676'],
  'retro-desktop': ['a6a8ba d88260 d3b263 6fa99b 8eaada', '4b60a0 683b37 575322 266052 4462a4'],
  chalkboard: ['eef1e4 e9b293 ebd797 b8d1a2 b3cddd', '515f41 754943 625936 3e6a55 365d7a'],
  'stained-glass': ['f4bd59 e58655 ecc455 91cd9e 83afe7', '654718 873c2b 634211 215c40 28548d'],
  'kraft-label': ['ae9e81 cd8964 c6a052 9fa77a 94a5b0', '635642 77452e 705528 535c3b 475875'],
};

const pigmentUsesSelection = (id) => id === 'retro-desktop' || id === 'kraft-label';
const pigmentFamily = (mark) => {
  const { c, h } = lch(mark);
  return c < 0.038 ? 0 : h < 54 || h >= 338 ? 1 : h < 115 ? 2 : h < 193 ? 3 : 4;
};

function pigmented(id, dark, alternate, base, mark) {
  if (!pigments[id]) return base;
  const paint = tone(pigments[id][+dark])[pigmentFamily(mark)];
  return blend(base, paint, alternate ? 0.76 : 0.84);
}

export const isMaterial = (id) => Object.hasOwn(materials, id);
const opaque = (color, backdrop) => color && rgb(hex(over(color, backdrop)));
const tone = (values) => values.split(' ').map((value) => rgb(`#${value}`));
const matte = (a, b, strength) => ({
  r: Math.round(a.r + (b.r - a.r) * strength),
  g: Math.round(a.g + (b.g - a.g) * strength),
  b: Math.round(a.b + (b.b - a.b) * strength), a: 1,
});

function swatches(id, dark, alternate) {
  const data = materials[id], [planes, inks] = data[dark ? 'dark' : 'light'];
  const palette = tone(planes);
  if (alternate) for (const [index, value] of Object.entries(data.alt[+dark])) palette[index] = rgb(`#${value}`);
  return [palette, tone(inks)];
}

// A fixed-point projection, rather than target += strength*(target-source).
// At 0% the caller returns the input. At positive strengths an opaque plane
// already inside its admissible colour neighborhood is left alone. Increasing
// strength narrows that neighborhood; at 100% only the authored paint remains.
function approach(from, anchor, allows, radius, mix = blend) {
  const origin = lab(anchor);
  const passes = (c) => allows(c) && delta(lab(c), origin) <= radius;
  if (passes(from)) return from;
  let lo = 0, hi = 1, best = anchor;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2, candidate = mix(from, anchor, mid);
    if (passes(candidate)) { best = candidate; hi = mid; } else lo = mid;
  }
  return best;
}

// The same body and small-text inks appear on several unrelated native surfaces.
// Keep all paper at the same polarity; reserve a luminance band so an opaque
// selection can still be distinguished from both canvas and file paper.
const paperBand = (dark, role) => {
  const limit = {
    reserved: [0.445, 0.085], syntax: [0.355, 0.087], local: [0.210, 0.158],
  }[role];
  return dark ? (c) => light(c) <= limit[1] : (c) => light(c) >= limit[0];
};
const uniformInk = (seed, fills, dark, threshold = 4.65) => {
  const pole = dark ? white : black;
  const limit = (color) => fills.every((bg) => ratio(color, bg) >= threshold &&
    (dark ? light(color) > light(bg) : light(color) < light(bg)));
  return approach(seed, pole, limit, Infinity, matte);
};

const px = (color) => hex(color);
const marks = {
  light: { error: '#9f2431', warning: '#74501b', success: '#18543b', info: '#254d8e' },
  dark: { error: '#ffaaaa', warning: '#f3d08c', success: '#a1e9b6', info: '#b1d3ff' },
};

/** Color-only counterpart to the legacy nativePaint adapter. */
export function materialPaint(id, model, strength, alternate) {
  const { dark } = model;
  const [[page, side, card, message, chosen, rule, ink, small, wash, file, linkInk], inks] = swatches(id, dark, alternate);
  const under = dark ? black : white, radius = 0.35 * (1 - strength) ** 2;
  const plane = (path, anchor, role = 'local') => {
    const allows = paperBand(dark, role), pole = dark ? black : white;
    const center = allows(anchor) ? anchor : approach(anchor, pole, allows, Infinity, matte);
    const from = opaque(model.color(path), model.canvas ?? under) ?? center;
    if (strength === 1) return center;
    // Cold light leaflet rails pass through uninked paper rather than mixing
    // blue and red ink. The converging blue/yellow bound is checked on the
    // emitted colour; reapplying one strength cannot add another coat.
    if (id === 'constructivist' && !dark && alternate && path === 'surface.muted' && lab(from).y < -0.015) {
      const cool = lch(from), warm = lch(center);
      const floor = lab(center).y - 0.5 * (1 - strength) ** 4;
      const throughPaper = (_from, _to, t) => {
        const ink = t < 0.5 ? cool : warm;
        return fromLch(cool.l + (warm.l - cool.l) * t, ink.c * Math.abs(2 * t - 1), ink.h);
      };
      return approach(from, center, (color) => allows(color) && lab(color).y >= floor, radius, throughPaper);
    }
    return approach(from, center, allows, radius);
  };
  const canvas = plane('surface.background', page, 'reserved'), rail = plane('surface.muted', side);
  const raised = plane('surface.elevated', card, 'syntax'), editor = plane('syntax.base.background', file, 'reserved');
  const chrome = [canvas, rail, raised, editor];
  const markSeed = opaque(model.color('primary.base'), model.canvas ?? under) ?? linkInk;
  // Classify the final resolved accent, not the input, so repeat application
  // cannot cross a hue boundary as the original mark is made readable.
  const mark = fit(markSeed, chrome, 3.35) ?? (dark ? white : black);
  const inSelection = pigmentUsesSelection(id);
  const bubbleAnchor = inSelection ? message : pigmented(id, dark, alternate, message, mark);
  const selectionAnchor = inSelection ? pigmented(id, dark, alternate, chosen, mark) : chosen;
  const bubble = plane('chat.userMessageBackground', bubbleAnchor), inline = plane('markdown.inlineCodeBackground', wash);
  // Anchor selections to the native 1.24 border threshold, with room for
  // rounding, without making the helper ink or status icons switch polarity.
  const selectionOK = (c) => paperBand(dark, 'local')(c) && [canvas, editor].every((b) => ratio(c, b) >= 1.26 &&
    (dark ? light(c) > light(b) : light(c) < light(b)));
  const selectionCenter = selectionOK(selectionAnchor) ? selectionAnchor : approach(selectionAnchor, dark ? white : black, (c) =>
    [canvas, editor].every((b) => ratio(c, b) >= 1.26 &&
      (dark ? light(c) > light(b) : light(c) < light(b))), Infinity, matte);
  const selection = strength === 1 ? selectionCenter
    : approach(opaque(model.color('interactive.selection'), model.canvas ?? under) ?? selectionCenter, selectionCenter, selectionOK, radius);
  const localFill = (color, foreground, weight, role = 'local') => approach(matte(color, foreground, weight), color,
    paperBand(dark, role), Infinity, matte);
  const diffAdd = localFill(canvas, rgb(dark ? '#55946f' : '#dceecf'), dark ? 0.62 : 0.74, 'syntax');
  const diffRemove = localFill(canvas, rgb(dark ? '#52232a' : '#d8a2a9'), dark ? 0.66 : 0.84, 'syntax');
  const diffCodeAdd = matte(editor, diffAdd, 0.75), diffCodeRemove = matte(editor, diffRemove, 0.75);
  // A typed fence in the composer uses --surface-subtle. Do not inherit a
  // saturated sidebar hover there; the chat fence and file editor have distinct fills.
  const subtle = localFill(raised, inline, 0.33, 'syntax');
  const surfaces = [...chrome, subtle, bubble, selection, inline, diffAdd, diffRemove, diffCodeAdd, diffCodeRemove];
  const baseInk = uniformInk(ink, surfaces, dark);
  // In-band very dark/light paints keep the tiny gutters usable at full ink.
  const hover = localFill(rail, baseInk, 0.045), active = localFill(rail, baseInk, 0.075);
  const foreground = uniformInk(baseInk, [...surfaces, hover, active], dark);
  const mutedForeground = uniformInk(small, [...surfaces, hover, active], dark);
  const link = uniformInk(blend(linkInk, mark, 0.24), [canvas, rail, raised, bubble], dark);
  const border = uniformInk(rule, chrome, dark, 3.45);
  const icon = uniformInk(rule, [...chrome, selection], dark, 3.2);
  const syntaxFills = [editor, raised, subtle, diffAdd, diffRemove, diffCodeAdd, diffCodeRemove];
  const syntaxInk = (color) => px(uniformInk(color, syntaxFills, dark));
  const actualInline = [canvas, bubble].map((bg) => matte(matte(bg, inline, 0.5), foreground, 0.04));
  const line = [canvas, raised, editor];
  const palette = marks[model.variant];
  return {
    surface: {
      background: px(canvas), muted: px(rail), elevated: px(raised), subtle: px(subtle),
      foreground: px(foreground), mutedForeground: px(mutedForeground),
    },
    primary: { base: px(mark) },
    pr: { draft: px(uniformInk(rgb(dark ? '#ece9eb' : '#4b4750'), [...chrome, selection], dark, 3.35)) },
    interactive: { border: px(border), borderHover: px(icon), borderFocus: px(icon), focus: px(icon), focusRing: px(icon),
      selection: px(selection), hover: px(hover), active: px(active) },
    chat: { userMessageBackground: px(bubble), divider: px(border) },
    markdown: { link: px(link), linkHover: px(uniformInk(blend(link, dark ? white : black, 0.18), [canvas, rail, raised, bubble], dark)),
      inlineCode: px(uniformInk(inks[2], [inline, ...actualInline], dark)), inlineCodeBackground: px(inline) },
    syntax: {
      base: { background: px(editor), foreground: syntaxInk(ink),
        ...Object.fromEntries(BASE_SYNTAX.map((key, i) => [key, syntaxInk(inks[i])])) },
      highlights: {
        diffAdded: px(uniformInk(rgb(dark ? '#d0fbe8' : '#06291b'), syntaxFills, dark, 3.25)),
        diffRemoved: px(uniformInk(rgb(dark ? '#d37e89' : '#a44857'), [editor, raised], dark, 3.25)),
        diffModified: px(uniformInk(rgb(palette.info), syntaxFills, dark)),
        diffAddedBackground: px(diffCodeAdd), diffRemovedBackground: px(diffCodeRemove),
        lineNumber: px(uniformInk(small, syntaxFills, dark)),
      },
    },
    tools: { icon: px(icon), border: px(border),
      edit: { addedBackground: px(diffAdd), removedBackground: px(diffRemove),
        lineNumber: px(uniformInk(small, [...line, diffAdd, diffRemove], dark)) } },
  };
}

export const materialStatus = (variant) => marks[variant];

export function materialSurfaceFailures(model) {
  const { dark } = model;
  const check = (role, valid) => {
    const color = model.back(role);
    return color && valid(color) ? [] : [{ code: 'paint-polarity', role, actual: color ? light(color) : null }];
  };
  return [
    ...['canvas', 'code'].flatMap((role) => check(role, paperBand(dark, 'reserved'))),
    ...['elevated', 'subtle', 'toolAdded', 'toolRemoved'].flatMap((role) => check(role, paperBand(dark, 'syntax'))),
    ...['muted', 'bubble', 'inline', 'selection'].flatMap((role) => check(role, paperBand(dark, 'local'))),
  ];
}

// At 100%, the six large planes must be saturated at their authored position,
// not quietly recoloured by a fallback intended for a different recipe.
export function materialFinishFailures(model, id) {
  const paths = ['canvas', 'muted', 'elevated',
    pigments[id] && !pigmentUsesSelection(id) ? null : 'bubble', pigmentUsesSelection(id) ? null : 'selection',
    null, null, null, 'inline', 'code'];
  const diffs = (alternate) => swatches(id, model.dark, alternate)[0].slice(0, paths.length).flatMap((rgb, i) => {
    const role = paths[i];
    return role && delta(lab(rgb), lab(model.back(role))) > 0.027
      ? [{ code: 'authored-paint', role, desired: hex(rgb), actual: hex(model.back(role)) }] : [];
  });
  const a = diffs(false), b = diffs(true);
  return a.length < b.length ? a : b;
}
