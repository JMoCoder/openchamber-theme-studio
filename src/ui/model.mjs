import { contrastRatio, parseColor, readableText } from '../../shared/theme-core.mjs';
import zh from '../i18n/ui.zh.mjs';
import en from '../i18n/ui.en.mjs';

export const VARIANTS = ['light', 'dark'];
export const TABS = ['theme', 'style', 'tune', 'refine', 'matching'];
export const TIERS = ['common', 'advanced', 'expert'];
export const FILE_LIMIT = 512 * 1024;
export const IMAGE_LIMIT = 16 * 1024 * 1024;
export const get = (obj, path) => String(path).split('.').reduce((value, key) => value?.[key], obj);
export const language = (locale) => /^zh/i.test(locale ?? '') ? 'zh' : 'en';
export const localized = (value, locale, fallback = '') => typeof value === 'string' ? value : value?.[locale] ?? value?.en ?? value?.zh ?? fallback;
export const words = (locale) => (key, params = {}) =>
  ((locale === 'zh' ? zh[key] : en[key]) ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
export const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(value, hi));

export const isHex = (value) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(String(value).trim());
export function isSafeColor(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 250) return false;
  if (/[;{}<>\\]/.test(value) || /\b(?:var|env|attr|url|image(?:-set)?|paint|light-dark)\s*\(|\b(?:currentcolor|inherit|initial|unset|revert(?:-layer)?)\b/i.test(value)) return false;
  if (!/^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([\w#.,%\s/+()-]*\))$/i.test(value.trim())) return false;
  return globalThis.CSS ? CSS.supports('color', value) : Boolean(parseColor(value));
}

export function colorToHex(rgba) {
  const byte = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${byte(rgba.r)}${byte(rgba.g)}${byte(rgba.b)}${rgba.a < 0.99804 ? byte(rgba.a * 255) : ''}`;
}

export function toHsv({ r, g, b, a = 1 }, lastHue = 0) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = lastHue;
  if (d > 0) h = ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  return { h, s: max === 0 ? 0 : d / max, v: max / 255, a };
}

export function fromHsv({ h, s, v, a }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

export function measurableColor(value, convert) {
  if (typeof value !== 'string') return null;
  return parseColor(value) ?? (isSafeColor(value) ? convert?.(value) ?? null : null);
}

export function contrastForField(field, value, colorOf, canvas, variant, convert) {
  const basis = variant === 'dark' ? '#000000' : '#ffffff';
  const solidCanvas = measurableColor(canvas, convert);
  const chosen = measurableColor(value, convert);
  return (field.contrast ?? []).flatMap(({ against, minimum, role }) => (against ?? []).map((path) => {
    const other = measurableColor(colorOf(path), convert);
    const backgroundIsSelected = /(?:background|elevated|muted|subtle|overlay|selection)$/i.test(field.path);
    const fg = backgroundIsSelected ? other : chosen;
    const bg = backgroundIsSelected ? chosen : other;
    const canvasColor = solidCanvas ? mix(basis, colorToHex(solidCanvas), solidCanvas.a) : basis;
    return { path, minimum, role, ratio: fg && bg ? contrastRatio(colorToHex(fg), colorToHex(bg), canvasColor) : null };
  }));
}

const fallback = {
  light: { bg: '#f8f7f5', surface: '#fdfcfb', fg: '#26231f', muted: '#615d57', border: '#d8d4cc', primary: '#a63b23', success: '#276345', warning: '#80520c', error: '#a02735', info: '#23578a' },
  dark: { bg: '#1c1b19', surface: '#242220', fg: '#efebe4', muted: '#b7afa4', border: '#383430', primary: '#ffa68c', success: '#92caaa', warning: '#e4b878', error: '#ff9da2', info: '#a2c9fe' },
};

const mix = (a, b, amount) => {
  const x = parseColor(a), y = parseColor(b);
  return colorToHex({ r: x.r + (y.r - x.r) * amount, g: x.g + (y.g - x.g) * amount, b: x.b + (y.b - x.b) * amount, a: 1 });
};

export function schemeForBackground(background) {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? 'light' : 'dark';
}

/** Keep app chrome legible even when the preview is deliberately illegible. */
export function chromePalette(tokens = {}, mode = 'light', convert) {
  const native = fallback[mode] ?? fallback.light;
  const opaque = (value, base) => {
    const color = measurableColor(value, convert);
    return color ? mix(base, colorToHex(color), clamp(color.a)) : base;
  };
  const offered = opaque(tokens.background, native.bg);
  const f = fallback[schemeForBackground(offered)];
  const { r, g, b } = parseColor(offered);
  // Fluorescent authored fills belong to the preview, not the working surface.
  const excess = clamp((Math.max(r, g, b) - Math.min(r, g, b) - 116) / 139);
  const bg = excess ? mix(offered, f.bg, excess * .89) : offered;
  const neutral = contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff';
  const other = neutral === '#000000' ? '#ffffff' : '#000000';
  const meets = (fg, backs, min) => backs.every((back) => contrastRatio(fg, back) >= min);
  const fitFill = (raw, weight) => {
    for (let step = 10; step > 0; step--) {
      const fill = mix(bg, raw, weight * step / 10);
      if (meets(neutral, [fill], 4.56)) return fill;
    }
    return bg;
  };
  const rawSurface = opaque(tokens.elevated, mix(bg, f.surface, .2));
  const surface = fitFill(rawSurface, contrastRatio(bg, rawSurface) >= 1.35 ? .18 : 1);
  const primary = opaque(tokens.primary, f.primary);
  const hover = fitFill(neutral, .065), selection = fitFill(primary, .16);
  const backgrounds = [bg, surface, hover, selection];
  const structural = (value, backs = backgrounds, min = 4.5) => {
    let low = 0, high = 1, result = neutral;
    const raw = opaque(value, neutral);
    if (meets(raw, backs, min)) return raw;
    for (let i = 0; i < 11; i += 1) {
      const mid = (low + high) / 2;
      const candidate = mix(raw, neutral, mid);
      if (meets(candidate, backs, min)) { result = candidate; high = mid; }
      else low = mid;
    }
    return result;
  };
  const focus = structural(tokens.focus ?? primary, backgrounds, 3);
  const action = readableText(opaque(tokens.primaryForeground, other), primary);
  const primaryHover = [mix(primary, '#000000', .08), mix(primary, '#ffffff', .08), primary]
    .sort((a, b) => contrastRatio(action, b) - contrastRatio(action, a))[0];
  return {
    bg, surface, fg: structural(tokens.foreground ?? f.fg), muted: structural(tokens.muted ?? f.muted),
    raised: structural(tokens.elevatedForeground ?? tokens.foreground ?? f.fg),
    'raised-muted': structural(tokens.muted ?? f.muted),
    line: structural(tokens.border ?? f.border, [bg], 1.3), control: structural(tokens.border ?? f.border, backgrounds, 3),
    hover, selection, primary, 'primary-hover': primaryHover, action, accent: structural(primary), focus,
    success: structural(tokens.successText ?? tokens.success ?? f.success), warning: structural(tokens.warningText ?? tokens.warning ?? f.warning),
    error: structural(tokens.errorText ?? tokens.error ?? f.error), info: structural(tokens.infoText ?? tokens.info ?? f.info),
  };
}

export function visibleFields(fields, { locale, query = '', tier = 'common', only = false, overrides = {}, target = '' }) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return fields.filter((field) => {
    if (field.type !== 'color' || field.effect?.kind === 'dead' || field.hidden || field.tier === 'hidden') return false;
    if (target === field.path) return true;
    if (only && !Object.hasOwn(overrides, field.path)) return false;
    if (!terms.length) {
      const rank = TIERS.indexOf(field.tier === 'basic' ? 'common' : field.tier);
      const effective = rank < 0 ? (field.group === 'syntax-tokens' ? 2 : field.required ? 0 : 1) : rank;
      if (effective > Math.max(0, TIERS.indexOf(tier))) return false;
    }
    const hay = [field.path, localized(field.label, locale), field.label?.zh, field.label?.en, localized(field.hint, locale)].filter(Boolean).join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

export function statusOf(state, t, variant = state.host?.mode ?? state.variant) {
  const { phase, host } = state;
  const active = host?.active?.[variant];
  const live = state.live?.[variant] ?? {};
  const connection = live.connection ?? (phase === 'degraded' ? 'unavailable' : 'off');
  const sync = live.sync ?? 'idle';
  const borrowed = active?.kind === 'saved' ? null : live.borrowed ?? null;
  const canBorrow = phase === 'ready' && ['off', 'idle'].includes(connection) && live.canTryOn === true;
  const selectionPaused = state.live?.enabled !== false && live.selectionBlocked === true &&
    ['off', 'idle', 'tryon', 'active'].includes(connection);
  const backupMissing = connection === 'prepare-error' && live.error?.code === 'PREVIEW_BACKUP_MISSING';
  const recovery = backupMissing ? live.recovery ?? 'preserve' : null;
  const params = { phase, variant, live, active, borrowed, canBorrow, connection, sync, selectionPaused, backupMissing, recovery };
  const cross = VARIANTS.includes(live.previewVariant) && live.previewVariant !== (host?.mode ?? variant);
  const colorMode = { preview: cross ? t(live.previewVariant) : '', mode: t(host?.mode ?? variant) };
  const withShownColors = (text) => cross ? `${text} · ${t('stateCrossShown', colorMode)}` : text;
  if (connection === 'checking' || (sync === 'preflight' && !['read-error', 'unavailable', 'conflict'].includes(connection))) {
    return { ...params, tone: 'info', text: withShownColors(t('stateCheckingFiles')) };
  }
  if (phase === 'booting') return { ...params, tone: 'neutral', text: t('stateBooting') };
  const editing = t(state.variant), mode = colorMode.mode;
  const name = borrowed?.name || active?.name || 'OpenChamber';
  const table = {
    unavailable: [fileUnavailableKey(live.readError?.code), 'warning'],
    'read-error': ['stateReadError', 'warning'], 'prepare-error': [
      recovery === 'builtin' ? 'stateLegacyPreview' : recovery ? 'stateBackupMissing' : 'statePrepareError', 'warning'],
    'verify-error': ['stateVerifyError', 'warning'], 'saved-error': ['stateSavedError', 'warning'],
    off: ['statePreview', 'neutral'], idle: ['statePreview', 'neutral'],
    tryon: ['stateTryon', 'success'], active: ['stateActive', 'success'], hidden: ['stateHidden', 'info'],
    conflict: ['stateConflict', 'warning'], error: ['stateError', 'error'],
  };
  let [key, tone] = table[connection] ?? table.off;
  if (['off', 'idle', 'tryon', 'active', 'hidden'].includes(connection)) {
    if (state.live?.enabled === false) [key, tone] = ['statePreviewOff', 'neutral'];
    else if (connection === 'hidden') [key, tone] = table.hidden;
    else if (selectionPaused) [key, tone] = ['stateSelectionPaused', 'warning'];
    else if (borrowed?.inUse === false) [key, tone] = ['stateBorrowInactive', 'warning'];
    else if (sync === 'timeout') [key, tone] = ['syncTimeout', 'warning'];
    else if (sync === 'writing') [key, tone] = ['syncWriting', 'info'];
    else if (sync === 'waiting') [key, tone] = ['syncWaiting', 'info'];
    else if (active?.kind === 'saved' && live.canPreview) {
      [key, tone] = live.previewVariant ? table.tryon : ['statePreviewReady', 'info'];
    }
    else if (borrowed && borrowed.inUse !== true) [key, tone] = ['stateBorrowUnknown', 'info'];
    else if (borrowed) [key, tone] = table.tryon;
    else if (canBorrow || active?.reason === 'ambiguous' && live.canPreview) [key, tone] = ['statePreviewReady', 'info'];
  }
  if (cross && ['stateTryon', 'stateActive'].includes(key)) {
    return { ...params, name, tone, text: t('stateCrossPreview', colorMode) };
  }
  return { ...params, name, tone, text: withShownColors(t(key, { editing, mode, name })) };
}

function fileUnavailableKey(code) {
  if (code === 'NO_THEME_DIRECTORY') return 'stateMissingDirectory';
  return code && code !== 'NOT_GRANTED' ? 'stateHostFilesUnavailable' : 'stateUnavailable';
}
export function fileUnavailableNote(code) {
  if (code === 'NO_THEME_DIRECTORY') return 'missingDirectoryNote';
  return code && code !== 'NOT_GRANTED' ? 'hostUnavailableNote' : 'offlineNote';
}
export const filesUnchecked = (status) => ['checking', 'read-error', 'unavailable'].includes(status.connection);
export const writeNeedsRetry = (status) => ['error', 'prepare-error', 'verify-error', 'saved-error'].includes(status.connection);

export function selectedCard(project, card) {
  const key = card.slug ?? card.id;
  return Boolean(project?.origin && (project.origin.ref === key || card.ids?.includes(project.origin.ref)));
}

export function variantsFor(value) {
  return VARIANTS.includes(value) ? [value] : [...VARIANTS];
}

export function auditSummary(report) {
  if (!report) return null;
  const failing = report.failures ?? report.issues ?? [];
  const score = typeof report.score === 'number' ? Math.round(report.score) : null;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return { score, failing, checks, pass: report.passed ?? report.pass ?? report.summary?.passed ?? checks.filter((c) => c.pass).length,
    total: report.total ?? checks.length, unknown: report.unknown ?? report.summary?.unmeasured ?? checks.filter((c) => c.pass == null).length };
}
