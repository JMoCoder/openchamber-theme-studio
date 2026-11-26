#!/usr/bin/env bun
// Rebuild the offline sheet with the real v2.8.0 parser and CSS generator.
// Run with bun --tsconfig-override "$UP/packages/ui/tsconfig.json" … "$UP".
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminalInks } from './presets-terminal.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
if (!process.argv[2]) throw new Error('用法：bun --tsconfig-override <upstream-ui-tsconfig> scripts/presets-sheet.mjs <upstream-root>');
const lib = resolve(process.argv[2], 'packages/ui/src/lib/theme');
const { requireTheme, themeListSchema } = await import(join(lib, 'definition.ts'));
const { CSSVariableGenerator } = await import(join(lib, 'cssGenerator.ts'));
const { getReadableThemeColors } = await import(join(lib, 'readableColors.ts'));
const { contrastRatio, mixColor } = await import(join(lib, 'color.ts'));
const { themes } = await import(join(lib, 'themes/index.ts'));
const { convertThemeToXterm } = await import(join(lib, '../terminalTheme.ts'));
const manifest = JSON.parse(await readFile(join(repo, 'presets/index.json'), 'utf8'));
const generator = new CSSVariableGenerator();
const compiled = {};
const sourceFiles = [];
let runtimePairs = 0, syntaxPairs = 0, terminalPairs = 0;
const minima = { runtime: Infinity, syntax: Infinity, comments: Infinity, selected: Infinity,
  terminal: Infinity, terminalDim: Infinity };
function test(kind, color, bg, floor, role, id) {
  const ratio = contrastRatio(color, bg);
  assert(ratio !== null && ratio >= floor, `${id} ${role} ${ratio ?? 'NaN'}/${floor}`);
  minima[kind] = Math.min(minima[kind], ratio);
  if (['syntax', 'comments'].includes(kind)) syntaxPairs++;
  else if (['terminal', 'terminalDim'].includes(kind)) terminalPairs++;
  else runtimePairs++;
}
for (const p of manifest.presets) {
  for (const { file, id } of Object.values(p.variants)) {
    const bytes = await readFile(join(repo, 'presets', file));
    const raw = JSON.parse(bytes);
    sourceFiles.push(raw);
    const theme = requireTheme(raw);
    const c = theme.colors, s = c.surface, dark = theme.metadata.variant === 'dark';
    assert.equal(theme.metadata.id, id);
    const readable = getReadableThemeColors(theme);
    for (const background of [s.background, s.elevated, s.muted]) {
      for (const [role, seed] of Object.entries({ primary: c.primary.base, error: c.status.error,
        warning: c.status.warning, success: c.status.success, info: c.status.info })) {
        const opacity = role === 'primary' ? (dark ? .30 : .22) : role === 'error' ? (dark ? .20 : .16) : .15;
        test('runtime', readable.tinted[role], mixColor(seed, background, opacity), 4.5, `button ${role}`, id);
      }
    }
    for (const [role, ink] of Object.entries(readable.status)) {
      test('runtime', ink, mixColor(c.status[`${role}Background`], s.background, 1), 4.5, `status ${role}`, id);
    }
    const selection = mixColor(c.interactive.selection, s.background, 1);
    for (const [role, ink] of Object.entries({ title: readable.selectionForeground,
      details: s.mutedForeground, ...c.pr })) test('selected', ink, selection, 4.5, `selection ${role}`, id);

    const highlights = c.syntax.highlights, base = c.syntax.base;
    const codeBacks = [base.background, s.elevated, s.muted, mixColor(c.interactive.selection, base.background, 1),
      ...['Added', 'Removed', 'Modified'].map((role) => mixColor(highlights[`diff${role}Background`], base.background, 1))];
    for (const [role, color] of Object.entries({ ...base, ...c.syntax.tokens })) {
      if (role === 'background') continue;
      const comment = role === 'comment' || role === 'commentDoc';
      for (const bg of codeBacks) test(comment ? 'comments' : 'syntax', color, bg, comment ? 4 : 4.5, role, id);
    }
    // TerminalView passes usePageColors().background; the dock blends the
    // two surfaces by day and takes muted by night. ANSI black is the muted
    // surface itself, not a body-ink role; brightBlack is the dim comment ink.
    for (const bg of [s.background, dark ? s.muted : mixColor(s.muted, s.background, 0.5)]) {
      const terminal = convertThemeToXterm(theme, bg);
      assert.equal(terminal.black, s.muted);
      for (const { name, ink, floor } of terminalInks(c)) {
        assert.equal(terminal[name], ink, `${id} ANSI ${name} 宿主映射已变化`);
        test(name === 'brightBlack' ? 'terminalDim' : 'terminal', ink, bg, floor, `ANSI ${name}`, id);
      }
    }
    const css = generator.generate(theme)
      .split('\n').map((line) => line.trim().replace(/:\s+/, ':')).filter((line) => line.startsWith('--')).join('')
      + `--diff-added:${highlights.diffAdded};--diff-removed:${highlights.diffRemoved};--line-number-active:${highlights.lineNumberActive};`;
    compiled[id] = { sha256: createHash('sha256').update(bytes).digest('hex'), css };
  }
}
assert.equal(themes.length, 62);
const expectedVariants = manifest.presets.length * 2;
assert.equal(themeListSchema.parse(sourceFiles).length, expectedVariants);
assert.equal(Object.keys(compiled).length, expectedVariants);
const presets = manifest.presets.map(({ slug, name, description, signature, syntaxStrategy, rank, style, variants }) =>
  ({ slug, name, description, signature, syntaxStrategy, rank, style: { label: style.label }, variants }));
const filename = join(repo, 'docs/presets-sheet.html');
const text = await readFile(filename, 'utf8');
const embedded = /(<script id="preset-data" type="application\/json">\n)[\s\S]*?(\n  <\/script>)/;
assert(embedded.test(text), '图册需要保留 preset-data 数据区域');
const safeJson = JSON.stringify({ presets, compiled }).replaceAll('<', '\\u003c');
await writeFile(filename, text.replace(embedded, (_, begin, end) => `${begin}    ${safeJson}${end}`));
console.log(`requireTheme + themeListSchema + CSSVariableGenerator ${sourceFiles.length}/${expectedVariants} · built-ins ${themes.length}`);
console.log(`Upstream ${runtimePairs} UI pairs · min ${minima.runtime.toFixed(3)} · selected ${minima.selected.toFixed(3)} (incl. muted + PR)`);
console.log(`Resolved syntax ${syntaxPairs} pairs · min ${minima.syntax.toFixed(3)} · comments ${minima.comments.toFixed(3)}`);
console.log(`Foreground / ANSI ${terminalPairs} pairs · min ${minima.terminal.toFixed(3)} · brightBlack ${minima.terminalDim.toFixed(3)}`);
