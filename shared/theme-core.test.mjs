import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactTheme, compactThemeLossless, contrastRatio, generateThemeCss, getReadableThemeColors,
  inspectThemeImport, mixColor, onColor, parseColor, parseTheme, SYNTAX_HIGHLIGHT_KEYS,
  SYNTAX_TOKEN_KEYS, ThemeValidationError, themeToCssVariables, validateTheme, withOpacity,
} from './theme-core.mjs';
import { MINIMAL } from '../scripts/research/upstream.mjs';

const sample = () => structuredClone(MINIMAL);

test('validates individual JSON paths; trims only IDs, names and colors', () => {
  const input = sample();
  input.metadata.name = '  My Name ';
  input.metadata.author = '  My Name ';
  input.colors.primary.base = '#abc  ';
  assert.deepEqual(validateTheme(input), []);
  assert.equal(parseTheme(input).colors.primary.base, '#abc');
  assert.equal(parseTheme(input).metadata.name, 'My Name');
  assert.equal(parseTheme(input).metadata.author, '  My Name ');
  delete input.colors.surface.foreground;
  input.colors.chat = { background: 'url(example)' };
  input.metadata.tags = [1];
  assert.deepEqual(validateTheme(input).map((item) => item.path), [
    ['metadata', 'tags', 0], ['colors', 'surface', 'foreground'], ['colors', 'chat', 'background'],
  ]);
  assert.throws(() => parseTheme(input), ThemeValidationError);
});

test('known defaults, runtime constants and alias inheritance', () => {
  const input = sample();
  input.colors.syntax.tokens = { class: '#369', method: '#099', variableProperty: '#890', stringEscape: '#a31', punctuation: '#2b2' };
  const resolved = parseTheme(input);
  const { surface, primary, interactive, syntax, pr, status } = resolved.colors;
  assert.equal(surface.overlay, '#00000099');
  assert.equal(surface.subtle, surface.muted);
  assert.equal(surface.elevatedForeground, surface.foreground);
  assert.equal(syntax.base.background, surface.background);
  assert.equal(interactive.focusRing, withOpacity(primary.base, .5));
  assert.equal(pr.open, status.success);
  assert.equal(pr.merged, '#8250df');
  assert.equal(syntax.tokens.className, '#369');
  assert.equal(syntax.tokens.enum, '#369');
  assert.equal(syntax.tokens.methodCall, '#099');
  assert.equal(syntax.tokens.tagAttribute, '#890');
  assert.equal(syntax.tokens.parameter, '#a31');
  assert.equal(syntax.tokens.tagBracket, '#2b2');
  assert.equal(SYNTAX_TOKEN_KEYS.length, 50);
  assert.equal(SYNTAX_HIGHLIGHT_KEYS.length, 8);
});

test('third-party import removes unknown token/highlight keys and reports exact paths', () => {
  const input = sample();
  input.colors.syntax.tokens = { commentDoc: '#abc', futureToken: '#fff', 'unknown;key': '#eee' };
  input.colors.syntax.highlights = { lineNumber: '#123', futureHighlight: '#fff' };
  const { definition, issues, warnings } = inspectThemeImport(input);
  assert.deepEqual(issues, []);
  assert.deepEqual(warnings.map(({ path }) => path.join('.')), [
    'colors.syntax.tokens.futureToken', 'colors.syntax.tokens.unknown;key', 'colors.syntax.highlights.futureHighlight',
  ]);
  assert.deepEqual(definition.colors.syntax.tokens, { commentDoc: '#abc' });
  assert.deepEqual(definition.colors.syntax.highlights, { lineNumber: '#123' });
  assert.equal(parseTheme(input).colors.syntax.tokens.futureToken, undefined);
  assert.deepEqual(input.colors.syntax.tokens.futureToken, '#fff');
});

test('upstream numeric colors, alpha behavior and CSS-only fallback', () => {
  assert.deepEqual(parseColor('#abcd'), { r: 170, g: 187, b: 204, a: 221 / 255 });
  assert.deepEqual(parseColor('rgb(10 20 30 / .25)'), { r: 10, g: 20, b: 30, a: .25 });
  assert.equal(parseColor('rgb(100% 100% 100%)'), null);
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('hsl(0 20% 20%)', '#fff'), null);
  assert.equal(onColor('oklch(.8 .06 220)', '#fff'), '#ffffff');
  assert.equal(withOpacity('#abc0', .5), '#aabbcc80');
  assert.equal(mixColor('#fff', '#000', .5), '#808080');
  assert.equal(mixColor('rebeccapurple', '#000', .5), 'color-mix(in srgb, rebeccapurple 50%, #000)');
});

test('generated declarations keep aliases, duplicate lines, important and readonly output', () => {
  const input = sample();
  input.colors.interactive.selectionForeground = '#fff';
  input.colors.interactive.selection = '#fff';
  const resolved = parseTheme(input);
  const css = generateThemeCss(resolved);
  assert.match(css, /--background: #f2f4f9 !important;/);
  assert.match(css, /--text-markdown: 0.875rem;/);
  assert.match(generateThemeCss(resolved, { vscode: true }), /--text-markdown: 0.8438rem;/);
  assert.equal(css.match(/--interactive-selection-foreground:/g).length, 2);
  assert.equal(themeToCssVariables(resolved)['--interactive-selection-foreground'], getReadableThemeColors(resolved).selectionForeground);
  assert.ok(contrastRatio(themeToCssVariables(resolved)['--interactive-selection-foreground'], '#fff') >= 4.5);
});

test('upstream prune can change custom selection contrast; lossless prune leaves it intact', () => {
  const input = sample();
  input.colors.interactive.selectionForeground = parseTheme(input).colors.interactive.selectionForeground;
  input.colors.interactive.selection = '#000000';
  input.colors.surface.subtle = input.colors.surface.muted;
  const before = parseTheme(input);
  const upstream = compactTheme(input);
  const safe = compactThemeLossless(input);
  assert.equal(upstream.colors.interactive.selectionForeground, undefined);
  assert.notEqual(parseTheme(upstream).colors.interactive.selectionForeground, before.colors.interactive.selectionForeground);
  assert.equal(safe.colors.surface.subtle, undefined);
  assert.deepEqual(parseTheme(safe), before);
  assert.equal(generateThemeCss(parseTheme(safe)), generateThemeCss(before));
});
