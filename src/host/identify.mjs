import { parseTheme } from '../../shared/theme-core.mjs';

// Exact v2.8.0 PluginPane ready colours (not browser-computed CSS).
export const TOKEN_PATHS = Object.freeze({
  elevated: 'surface.elevated', foreground: 'surface.foreground',
  muted: 'surface.mutedForeground', subtle: 'surface.subtle',
  border: 'interactive.border', hover: 'interactive.hover',
  selection: 'interactive.selection', focus: 'interactive.focusRing',
  primary: 'primary.base', elevatedForeground: 'surface.elevatedForeground',
  active: 'interactive.active', primaryForeground: 'primary.foreground',
  success: 'status.success', warning: 'status.warning', error: 'status.error', info: 'status.info',
  syntaxKeyword: 'syntax.base.keyword', syntaxString: 'syntax.base.string',
  syntaxNumber: 'syntax.base.number', syntaxFunction: 'syntax.base.function',
  syntaxType: 'syntax.base.type', syntaxComment: 'syntax.base.comment',
  syntaxVariable: 'syntax.base.variable', syntaxOperator: 'syntax.base.operator',
});

export const getAt = (root, path) => path.split('.').reduce((node, key) => node?.[key], root);
export const tokensForTheme = (definition) => {
  const { colors } = parseTheme(definition);
  return Object.fromEntries(Object.entries(TOKEN_PATHS).map(([key, path]) =>
    [key, getAt(colors, path) ?? (key === 'primaryForeground' ? '#ffffff' : undefined)]));
};
export function tokenKey(tokens) {
  const values = Object.keys(TOKEN_PATHS).map((name) => tokens?.[name]);
  return values.every((value) => typeof value === 'string' && value.length)
    ? JSON.stringify(values.map((value) => value.toLowerCase())) : null;
}
export const themeKey = (definition) => tokenKey(tokensForTheme(definition));

const hexChannels = (value) => /^#[\da-f]{6}$/iu.test(value)
  ? value.slice(1).match(/../gu).map((part) => Number.parseInt(part, 16)) : null;
const MAX_PLACEHOLDER_STEP = 8;
export function isPlaceholderOperator(original, marked) {
  const a = hexChannels(original), b = hexChannels(marked);
  if (!a || !b) return false;
  const steps = a.map((channel, i) => Math.abs(channel - b[i])).filter(Boolean);
  return steps.length === 1 && steps[0] <= MAX_PLACEHOLDER_STEP;
}

// An empty backup has to become a selectable theme (the SDK cannot unlink).
// Give just that placeholder a near-identical operator color so it does not
// impersonate a factory or saved theme. The editable project stays pristine.
export function distinguishPlaceholder(definition, occupied) {
  const theme = parseTheme(definition);
  const base = theme.colors.syntax.base;
  const rgb = hexChannels(base.operator);
  if (!rgb) return null;
  for (let step = 1; step <= MAX_PLACEHOLDER_STEP; step++) {
    for (const part of [2, 1, 0]) {
      for (const sign of [-1, 1]) {
        const value = rgb[part] + step * sign;
        if (value < 0 || value > 255) continue;
        const hex = rgb.map((channel, index) => (index === part ? value : channel).toString(16).padStart(2, '0')).join('');
        const candidate = { ...theme, colors: { ...theme.colors, syntax: { ...theme.colors.syntax, base: { ...base, operator: `#${hex}` } } } };
        if (!occupied.has(themeKey(candidate))) return candidate;
      }
    }
  }
  return null;
}

export function identifyTheme(snapshot, candidates) {
  const key = tokenKey(snapshot?.tokens);
  const variant = snapshot?.mode;
  if (key && (variant === 'light' || variant === 'dark')) {
    const matches = candidates.filter((candidate) => candidate.variant === variant && candidate.key === key);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      if (matches.some(({ kind }) => kind === 'saved')) return { kind: 'unknown', variant, reason: 'ambiguous', namedTie: true };
      const stock = matches.filter(({ kind }) => kind === 'builtin');
      const slot = matches.find(({ kind }) => kind === 'slot' || kind === 'tryon');
      // Keep recovery for legacy slot/stock ties. Named files never
      // participate in a write to find out which ID the host selected.
      if (stock.length === 1 && slot) {
        const offers = slot.id === stock[0].id ? [stock[0]] : [slot, stock[0]];
        return { kind: 'unknown', variant, reason: 'ambiguous', offers };
      }
      return { kind: 'unknown', variant, reason: 'ambiguous' };
    }
  }
  return { kind: 'unknown', variant, reason: 'unmatched' };
}
