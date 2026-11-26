import { SYNTAX_HIGHLIGHT_KEYS, SYNTAX_TOKEN_KEYS } from '../../shared/theme-core.mjs';

const group = (prefix, keys, type = 'color') => keys.map((key) => ({ path: `${prefix}.${key}`, type }));
export const STYLE_PATHS = [
  ...group('metadata', ['id', 'name', 'description', 'version', 'author'], 'text'),
  ...group('metadata', ['variant'], 'enum'),
  ...group('metadata', ['tags'], 'tags'),
  ...group('colors.surface', ['background', 'foreground', 'muted', 'mutedForeground', 'elevated', 'elevatedForeground', 'overlay', 'subtle']),
  ...group('colors.primary', ['base', 'foreground', 'hover', 'active', 'muted']),
  ...group('colors.interactive', ['border', 'borderHover', 'borderFocus', 'focus', 'focusRing', 'selection', 'selectionForeground', 'cursor', 'hover', 'active']),
  ...group('colors.status', ['error', 'warning', 'success', 'info'].flatMap((key) => ['', 'Foreground', 'Background', 'Border'].map((suffix) => key + suffix))),
  ...group('colors.pr', ['open', 'draft', 'blocked', 'merged', 'closed']),
  ...group('colors.syntax.base', ['background', 'foreground', 'comment', 'keyword', 'string', 'number', 'function', 'variable', 'type', 'operator']),
  ...group('colors.syntax.tokens', SYNTAX_TOKEN_KEYS),
  ...group('colors.syntax.highlights', SYNTAX_HIGHLIGHT_KEYS),
  ...group('colors.chat', ['background', 'userMessageBackground', 'divider']),
  ...group('colors.markdown', ['link', 'linkHover', 'inlineCode', 'inlineCodeBackground', 'blockquote', 'blockquoteBorder', 'listMarker', 'bold', 'italic', 'strikethrough', 'hr']),
  ...group('colors.tools', ['border', 'icon', 'title', 'description']),
  ...group('colors.tools.edit', ['addedBackground', 'removedBackground', 'modifiedBackground', 'lineNumber']),
  ...group('config.fonts', ['sans', 'mono', 'heading'], 'font-stack'),
  ...group('config.transitions', ['fast', 'normal', 'slow'], 'transition'),
];

export function sentinel({ path, type }, alternate = false) {
  switch (type) {
    case 'color': return alternate ? '#e70fa2' : '#1267cd';
    case 'enum': return 'dark';
    case 'tags': return alternate ? ['research-B', 'research'] : ['research-A'];
    case 'font-stack': return alternate ? '"Research Mono B", monospace' : '"Research Serif A", serif';
    case 'transition': return alternate ? '317ms ease-out' : '871ms linear';
    default: return `${path}-research-${alternate ? 'B' : 'A'}`;
  }
}
