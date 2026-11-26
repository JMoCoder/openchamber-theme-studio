// Numerical helpers for the editor, not an alternative host CSS parser.
import { parseColor } from './theme-core.mjs';

export const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(value, hi));
export const number = (value, fallback, lo, hi) => Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
export const turn = (h) => ((h % 360) + 360) % 360;
export const angleGap = (a, b) => Math.abs(turn(a - b + 180) - 180);
export const rgb = (value) => typeof value === 'string' ? parseColor(value) : null;
export const black = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const white = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

const bytes = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const linearRaw = (byte) => byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;
const linearTable = Array.from({ length: 256 }, (_, i) => linearRaw(i));
const linear = (byte) => linearTable[byte] ?? linearRaw(byte);
const gamma = (v) => 255 * clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function decimal(value) {
  const [mantissa, exponent] = `${value}`.split('e-');
  return exponent ? `0.${'0'.repeat(Number(exponent) - 1)}${mantissa.replace('.', '')}` : mantissa;
}

export function hex(color) {
  const { a, r, g, b } = color;
  const [x, y, z] = [Math.round(r), Math.round(g), Math.round(b)];
  if (a === 1) return `#${bytes[x]}${bytes[y]}${bytes[z]}`;
  const byte = Math.round(a * 255);
  return byte / 255 === a ? `#${bytes[x]}${bytes[y]}${bytes[z]}${bytes[byte]}` : `rgba(${x},${y},${z},${decimal(a)})`;
}

export function over(front, back) {
  if (front.a === 1) return front;
  if (front.a === 0) return back;
  const weight = 1 - front.a;
  return { r: front.r * front.a + back.r * weight, g: front.g * front.a + back.g * weight, b: front.b * front.a + back.b * weight, a: 1 };
}

export function light(color) {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

const ratioOf = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const ratio = (foreground, background) => ratioOf(light(over(foreground, background)), light(background));
export const under = (variant) => variant === 'dark' ? black : white;

export function lab(color) {
  const r = linear(color.r), g = linear(color.g), b = linear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    x: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    y: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

function inverse(l, x, y) {
  const p = (l + 0.3963377774 * x + 0.2158037573 * y) ** 3;
  const q = (l - 0.1055613458 * x - 0.0638541728 * y) ** 3;
  const s = (l - 0.0894841775 * x - 1.291485548 * y) ** 3;
  return [4.0767416621 * p - 3.3077115913 * q + 0.2309699292 * s,
    -1.2684380046 * p + 2.6097574011 * q - 0.3413193965 * s,
    -0.0041960863 * p - 0.7034186147 * q + 1.707614701 * s];
}

export function lch(color, fallback = 255) {
  const { l, x, y } = lab(color);
  const c = Math.hypot(x, y);
  return { l, c, h: c < 0.006 ? fallback : turn(Math.atan2(y, x) * 180 / Math.PI), a: color.a };
}

function colorInGamut(l, c, cos, sin, a) {
  const valid = (channels) => channels.every((v) => v >= -1e-7 && v <= 1.0000001);
  let channels = inverse(l, c * cos, c * sin);
  if (!valid(channels)) {
    let low = 0, high = c;
    channels = inverse(l, 0, 0);
    for (let i = 0; i < 9; i++) {
      const mid = (low + high) / 2;
      const next = inverse(l, mid * cos, mid * sin);
      if (valid(next)) { low = mid; channels = next; }
      else high = mid;
    }
  }
  return { r: Math.round(gamma(channels[0])), g: Math.round(gamma(channels[1])), b: Math.round(gamma(channels[2])), a };
}

export function fromLch(l, c, h, alpha = 1) {
  const rad = h * Math.PI / 180;
  return colorInGamut(clamp(l), Math.max(0, c), Math.cos(rad), Math.sin(rad), alpha);
}

export const swatch = (l, c, h, a) => hex(fromLch(l, c, h, a));
export const delta = (a, b) => Math.hypot(a.l - b.l, a.x - b.x, a.y - b.y);
export const chromaDelta = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function blend(first, second, amount) {
  if (amount >= 1 || !first) return second;
  if (amount <= 0) return first;
  const p = lab(first), q = lab(second);
  const x = p.x + (q.x - p.x) * amount, y = p.y + (q.y - p.y) * amount;
  return colorInGamut(p.l + (q.l - p.l) * amount, Math.hypot(x, y), x === 0 && y === 0 ? 1 : Math.cos(Math.atan2(y, x)),
    x === 0 && y === 0 ? 0 : Math.sin(Math.atan2(y, x)), first.a + (second.a - first.a) * amount);
}

// Project onto a WCAG threshold by changing OKLCH lightness first. Compare both
// directions in OKLab; sRGB gamut compression reduces chroma, never clips hue.
// Adjacent inconsistent fills can have no common solution. Tell callers rather
// than claiming that black/white will necessarily pass on every background.
export function fit(color, backgrounds, minimum, { preserveAlpha = false } = {}) {
  if (!backgrounds.length) return color;
  const bgs = backgrounds.map((bg) => [bg, light(bg)]);
  const passes = (candidate) => {
    if (candidate.a === 1) {
      const value = light(candidate);
      return bgs.every(([, other]) => ratioOf(value, other) >= minimum);
    }
    return bgs.every(([bg, other]) => ratioOf(light(over(candidate, bg)), other) >= minimum);
  };
  if (passes(color)) return color;
  const origin = lab(color), c = Math.hypot(origin.x, origin.y);
  const cos = c ? origin.x / c : 1, sin = c ? origin.y / c : 0;
  function search(alpha) {
    const candidate = (l) => colorInGamut(l, c, cos, sin, alpha);
    const start = { ...color, a: alpha };
    if (passes(start)) return start;
    const found = [];
    for (const end of [0, 1]) {
      let a = origin.l, z = end, best = candidate(end);
      if (!passes(best)) {
        if (bgs.length < 2) continue;
        // Opposite-polarity neighbours can create an interior feasible
        // interval. For opaque colours compute its luminance boundaries.
        if (alpha === 1) {
          const points = [0, 1];
          for (const [, y] of bgs) points.push((y + 0.05) / minimum - 0.05, (y + 0.05) * minimum - 0.05);
          points.sort((x, y) => x - y);
          let interior;
          for (let i = 1; i < points.length; i++) {
            const y = (points[i - 1] + points[i]) / 2;
            if (y <= 0 || y >= 1 || !bgs.every(([, other]) => ratioOf(y, other) >= minimum)) continue;
            let lo = 0, hi = 1;
            for (let step = 0; step < 11; step++) {
              const mid = (lo + hi) / 2;
              if (light(candidate(mid)) > y) hi = mid;
              else lo = mid;
            }
            const point = (lo + hi) / 2;
            if ((point - a) * (end - a) > 0 && passes(candidate(point))
              && (interior === undefined || Math.abs(point - a) < Math.abs(interior - a))) interior = point;
          }
          if (interior === undefined) continue;
          z = interior; best = candidate(z);
        } else {
          for (let i = 1; i < 12; i++) {
            z = a + (end - a) * i / 12;
            best = candidate(z);
            if (passes(best)) break;
          }
          if (!passes(best)) continue;
        }
      }
      for (let i = 0; i < 11; i++) {
        const mid = (a + z) / 2, next = candidate(mid);
        if (passes(next)) { z = mid; best = next; }
        else a = mid;
      }
      found.push(best);
    }
    if (found.length < 2) return found[0] ?? null;
    return delta(origin, lab(found[0])) <= delta(origin, lab(found[1])) ? found[0] : found[1];
  }
  return search(color.a) ?? (color.a < 1 && !preserveAlpha ? search(1) : null);
}

const CVD = [
  [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
];
export function redGreenDistance(first, second) {
  const simulate = (color, m) => {
    const r = linear(color.r), g = linear(color.g), b = linear(color.b);
    return lab({ r: gamma(m[0] * r + m[1] * g + m[2] * b),
      g: gamma(m[3] * r + m[4] * g + m[5] * b), b: gamma(m[6] * r + m[7] * g + m[8] * b), a: 1 });
  };
  return Math.min(...CVD.map((matrix) => delta(simulate(first, matrix), simulate(second, matrix))));
}
