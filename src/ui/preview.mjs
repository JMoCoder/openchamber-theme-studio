import { parseTheme, themeToCssVariables } from '../../shared/theme-core.mjs';
import { button, icon, node } from './dom.mjs';
import { get, isSafeColor } from './model.mjs';

const previewVariables = [
  'background', 'foreground', 'muted-foreground', 'card', 'card-foreground', 'border', 'input',
  'primary', 'primary-foreground', 'interactive-hover', 'interactive-focus-ring', 'interactive-selection',
  'interactive-selection-foreground', 'sidebar-base', 'sidebar-accent-base', 'sidebar-foreground',
  'chat-user-message-bg', 'markdown-link', 'markdown-inline-code', 'markdown-inline-code-bg',
  'syntax-background', 'syntax-foreground', 'syntax-keyword', 'syntax-number', 'syntax-string',
  'syntax-variable', 'syntax-operator', 'syntax-line-number', 'tools-border', 'tools-title', 'tools-icon',
  'tools-description', 'tools-edit-added-bg', 'tools-edit-removed-bg', 'tools-edit-line-number',
  ...['error', 'success', 'info', 'warning'].flatMap((tone) => [`status-${tone}-background`, `status-${tone}-text`, `status-${tone}-border`]),
  'pr-merged', 'pr-open',
];

const direct = { 'line-active': 'colors.syntax.highlights.lineNumberActive' };
const swatchCache = new WeakMap();

function setValue(root, name, value) {
  // Use properties, not interpolated CSS. Every name below is from a fixed allowlist.
  const variable = `--v-${name}`;
  const before = root.style.getPropertyValue(variable);
  if (before === value) return;
  if (isSafeColor(value)) root.style.setProperty(variable, value);
  else if (before) root.style.removeProperty(variable);
}

export function previewColors(root, parsed, variables) {
  if (!parsed) return;
  const vars = variables ?? themeToCssVariables(parsed);
  for (const name of previewVariables) setValue(root, name, vars[`--${name}`]);
  for (const [name, path] of Object.entries(direct)) setValue(root, name, get(parsed, path));
  if (root.dataset.variant !== parsed.metadata.variant) root.dataset.variant = parsed.metadata.variant;
}

export function miniPreview(t, labelFor) {
  const target = (className, label, path, ...children) =>
    node('button', { type: 'button', class: `sample-hit ${className}`, 'data-act': 'preview-field', 'data-path': path,
      title: labelFor(path), 'aria-label': `${label}: ${labelFor(path)}` }, children.length ? children : label);
  const branch = (label, path, tone) => target(`sample-lozenge ${tone}`, label, path, icon('branch', 10), label);
  const shorten = (key) => [node('span', { class: 'sample-label-full', text: t(key) }), node('span', { class: 'sample-label-short', text: t(`${key}Short`) })];
  const status = (label, path, tone, glyph) => target(`sample-lozenge sample-status ${tone}`, label, path, icon(glyph, 10), label);
  const codeText = (cls, label, path) => target(`sample-code-word ${cls}`, label, `colors.syntax.base.${path}`);
  const change = (tone, sign, value) => node('div', { class: `sample-change ${tone}` },
    target('sample-change-number', tone === 'removed' ? '05' : '06', 'colors.tools.edit.lineNumber'),
    target('sample-change-text', `${sign} ttl = ${value};`, `colors.tools.edit.${tone}Background`));
  return node('div', { class: 'sample', role: 'group', 'aria-label': t('previewOutline') },
    node('aside', { class: 'sample-rail' },
      target('sample-folder', t('mockProject'), 'colors.surface.muted', icon('folder', 12), shorten('mockProject')),
      target('sample-nav picked', t('mockSelected'), 'colors.interactive.selection', icon('chat', 11), shorten('mockSelected')),
      target('sample-nav', t('mockOther'), 'colors.surface.mutedForeground', icon('branch', 11), shorten('mockOther')),
      node('div', { class: 'sample-rail-bottom' }, target('sample-switch', t('mockSwitch'), 'colors.primary.base',
        node('span', { class: 'sample-switch-track', 'aria-hidden': 'true' }), shorten('mockSwitch')))),
    node('div', { class: 'sample-chat' },
      node('div', { class: 'sample-first-line' },
        target('sample-assistant', t('mockAssistant'), 'colors.surface.foreground', node('span', { class: 'sample-model-dot' }), t('mockAssistant')),
        target('sample-bubble', t('mockUser'), 'colors.chat.userMessageBackground')),
      node('div', { class: 'sample-markdown' }, target('sample-prose', t('mockCanvas'), 'colors.surface.background', t('mockPrefix')),
        target('sample-inline', 'cacheKey', 'colors.markdown.inlineCode'), t('mockSuffix'), ' ',
        target('sample-doc', t('mockDoc'), 'colors.markdown.link')),
      node('div', { class: 'sample-split' },
        node('div', { class: 'sample-editor' },
          target('sample-code-head', t('mockCode'), 'colors.syntax.base.background', icon('code', 12), t('mockCode')),
          node('div', { class: 'sample-code-row' }, target('sample-line', '1', 'colors.syntax.highlights.lineNumber'), codeText('keyword', 'const', 'keyword'), ' ', codeText('var', 'ttl', 'variable'),
            codeText('operator', '=', 'operator'), codeText('number', '30', 'number')),
          node('div', { class: 'sample-code-row is-active' }, target('sample-line', '2', 'colors.syntax.highlights.lineNumberActive'), codeText('keyword', 'return', 'keyword'),
            codeText('string', '"cache"', 'string'))),
        node('div', { class: 'sample-tool' },
          target('sample-tool-head', t('mockTool'), 'colors.tools.border', icon('file', 12), t('mockTool'), node('span', { text: 'cache.ts' })),
          change('removed', '−', '60'), change('added', '+', '30'))),
      node('div', { class: 'sample-statuses' },
        status(t('mockSuccess'), 'colors.status.success', 'success', 'check'),
        status(t('mockWarning'), 'colors.status.warning', 'warning', 'warning'),
        status(t('mockError'), 'colors.status.error', 'error', 'x'),
        status(t('mockInfo'), 'colors.status.info', 'info', 'info'),
        branch(t('mockMerged'), 'colors.pr.merged', 'merged')),
      node('div', { class: 'sample-composer' },
        target('sample-compose-text', t('mockComposer'), 'colors.interactive.border'),
        target('sample-send', t('mockSend'), 'colors.primary.foreground', icon('arrowUp', 13)))));
}

function themeSwatches(input) {
  if (!input) return null;
  if (input.canvas) return input;
  if (!input.colors) return null;
  if (swatchCache.has(input)) return swatchCache.get(input);
  try {
    const parsed = parseTheme(input);
    const v = themeToCssVariables(parsed);
    const swatches = {
      canvas: v['--background'], sidebar: v['--sidebar-base'], elevated: v['--card'], primary: v['--primary'], line: v['--border'],
      selection: v['--interactive-selection'], foreground: v['--foreground'],
      primaryInk: v['--primary-foreground'], railInk: v['--sidebar-foreground'], selectionInk: v['--interactive-selection-foreground'],
      bubble: v['--chat-user-message-bg'], code: v['--syntax-background'],
      syntax: ['keyword', 'string', 'number', 'function', 'variable'].map((name) => v[`--syntax-${name}`]),
    };
    swatchCache.set(input, swatches);
    return swatches;
  } catch { return null; }
}

export function cardSwatches(card, variant) {
  const v = card.variants?.[variant];
  return themeSwatches(v?.definition ?? v?.theme ?? (v?.colors ? v : null) ?? card.themes?.[variant]
    ?? card.base?.[variant] ?? card.pair?.[variant] ?? card[variant] ?? card.definitions?.[variant]
    ?? (card.variant === variant ? card.definition ?? card.theme : null))
    ?? themeSwatches(v?.swatches ?? v ?? card.swatches?.[variant] ?? (card.variant === variant ? card.swatches : null));
}

function tile(colors, variant) {
  const fallback = variant === 'dark'
    ? { canvas: '#242327', sidebar: '#19181b', elevated: '#312f36', primary: '#a7a4aa', foreground: '#d8d5dc', syntax: ['#a7a4aa', '#b7b6b9', '#87858a'] }
    : { canvas: '#f5f3f0', sidebar: '#e7e4e0', elevated: '#fff', primary: '#66616a', foreground: '#373439', syntax: ['#777', '#a39fa5', '#444'] };
  const from = (key) => isSafeColor(colors?.[key]) ? colors[key] : fallback[key];
  const code = colors?.syntax?.filter(isSafeColor) ?? fallback.syntax;
  const selection = isSafeColor(colors?.selection) ? colors.selection : from('primary');
  const bubble = isSafeColor(colors?.bubble) ? colors.bubble : from('elevated');
  const colorBlocks = (shades) => shades.map((value) => node('i', { style: { '--tile-ink': value } }));
  return node('span', { class: 'theme-tile', 'aria-hidden': 'true', style: {
    '--tile-canvas': from('canvas'), '--tile-rail': from('sidebar'), '--tile-elevated': from('elevated'),
    '--tile-primary': from('primary'), '--tile-fg': from('foreground'),
    '--tile-bubble': bubble,
    '--tile-line': isSafeColor(colors?.line) ? colors.line : null,
    '--tile-selection': selection,
    '--tile-primary-ink': isSafeColor(colors?.primaryInk) ? colors.primaryInk : from('canvas'),
    '--tile-selection-ink': isSafeColor(colors?.selectionInk) ? colors.selectionInk : from('foreground'),
    '--tile-rail-ink': isSafeColor(colors?.railInk) ? colors.railInk : from('foreground'),
  } },
  node('span', { class: 'theme-tile-rail' }, node('i'), node('i', { class: 'theme-tile-selection' }), node('i')),
  node('span', { class: 'theme-tile-chat' }, node('i', { class: 'theme-tile-bubble' }),
    node('span', { class: 'theme-tile-code' }, colorBlocks(code.slice(0, 5))),
    node('i', { class: 'theme-tile-input' })),
  node('span', { class: 'theme-tile-signature' },
    colorBlocks([from('primary'), selection, bubble, code[0] || from('foreground'), code[1] || from('sidebar')])));
}

export function themeCard(t, { label, detail, colors, id, action, selected = false, variant, pending = false }) {
  const shown = variant ? [variant] : ['light', 'dark'].filter((v) => colors?.[v]);
  const tileVariants = shown.length ? shown : ['light', 'dark'];
  return node('button', {
    type: 'button', class: `theme-card${selected ? ' is-selected' : ''}`, 'data-act': action, 'data-id': id,
    'data-focus': `${action}:${id}`,
    'aria-label': t('chooseTheme', { name: label }), 'aria-pressed': String(selected), title: detail || label,
    disabled: pending,
  }, node('span', { class: `theme-card-pair${tileVariants.length === 1 ? ' single' : ''}` }, tileVariants.map((v) => tile(colors?.[v], v))),
  node('span', { class: 'theme-card-caption' }, node('span', { class: 'theme-card-name', text: label }),
    selected && node('span', { class: 'theme-card-selected', title: t('selected') }, icon('check', 12))),
  detail && node('span', { class: 'theme-card-detail', text: detail }));
}

export { themeSwatches };
