import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_PATHS, sentinel } from './style-paths.mjs';
import { cssDeclarations, loadUpstream, MINIMAL, researchArgs, setPath, UI } from './upstream.mjs';

const { source, rest } = researchArgs();
if (rest.some((arg) => arg !== '--write')) throw new Error('仅支持 --write');
const u = await loadUpstream(source);
const c = new u.css.CSSVariableGenerator();
const snapshots = (value) => {
  const theme = u.definitions.requireTheme(value);
  const terminal = u.terminal.convertThemeToXterm(theme);
  const textMate = u.textMate.buildTextMateThemeFromAppTheme(theme);
  const zed = u.zed.buildZedThemeFromAppTheme(theme);
  return {
    css: cssDeclarations(c.generate(theme)),
    terminal,
    ghostty: u.terminal.toGhosttyTheme(terminal),
    markdown: u.markdown.getMarkdownSyntaxVars(theme),
    textMateColors: textMate.colors,
    textMateScopes: Object.fromEntries(textMate.tokenColors.map((rule, index) => [`${index}:${rule.name ?? 'default'}`, rule.settings])),
    zed: zed.style.syntax,
  };
};
const diff = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  .filter((key) => JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])).sort();

const inputs = [
  structuredClone(MINIMAL),
  structuredClone(MINIMAL),
  structuredClone(MINIMAL),
];
inputs[1].metadata.variant = 'dark';
for (const field of STYLE_PATHS) {
  const selected = field.type === 'color' ? '#546172' : sentinel(field, true);
  setPath(inputs[2], field.path.split('.'), selected);
}
const bases = inputs.map(snapshots);
assert.deepStrictEqual(Object.keys(u.syntax.resolveSyntaxTokens({ base: MINIMAL.colors.syntax.base })).sort(),
  STYLE_PATHS.filter(({ path }) => path.startsWith('colors.syntax.tokens.')).map(({ path }) => path.split('.').at(-1)).sort());
assert.deepStrictEqual(Object.keys(u.definitions.requireTheme(MINIMAL).colors.syntax.highlights).sort(),
  STYLE_PATHS.filter(({ path }) => path.startsWith('colors.syntax.highlights.')).map(({ path }) => path.split('.').at(-1)).sort());

const fields = STYLE_PATHS.map((field) => {
  const effects = Object.fromEntries(Object.keys(bases[0]).map((key) => [key, new Set()]));
  const directCss = new Set();
  for (let index = 0; index < inputs.length; index++) {
    for (const alternate of [false, true]) {
      const changed = structuredClone(inputs[index]);
      const value = field.type === 'enum' && changed.metadata.variant === 'dark' ? 'light' : sentinel(field, alternate);
      setPath(changed, field.path.split('.'), value);
      const result = snapshots(changed);
      for (const key of Object.keys(result)) {
        for (const name of diff(bases[index][key], result[key])) {
          effects[key].add(name);
          if (index === 2 && key === 'css') directCss.add(name);
        }
      }
    }
  }
  const { css, ...consumers } = Object.fromEntries(Object.entries(effects).map(([key, values]) => [key, [...values].sort()]));
  return { path: field.path, css, directCss: [...directCss].sort(), directThemeAdapters: Object.fromEntries(Object.entries(consumers).filter(([, items]) => items.length)) };
});

function* walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith('.') || ['node_modules', 'assets', '__tests__', '__fixtures__'].includes(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) yield* walk(path);
    else if (/\.(?:css|ts|tsx|js|jsx|html)$/.test(item.name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(item.name)) yield path;
  }
}

const used = new Map();
const aliases = new Map();
const utilityRefs = new Map();
const add = (table, key, value) => {
  if (!table.has(key)) table.set(key, new Set());
  table.get(key).add(value);
};
const variables = new Set(fields.flatMap(({ css }) => css));
const insideCssGate = /\/lib\/theme\/(?:cssGenerator|definition|syntax|color|readableColors)\.ts$/;
let scannedFiles = 0;
for (const path of walk(join(source, UI))) {
  const relativePath = relative(source, path);
  if (insideCssGate.test(relativePath)) continue;
  scannedFiles++;
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    const location = `${relativePath}:${index + 1}`;
    const decl = /^\s*(--[\w-]+)\s*:/.exec(line)?.[1];
    for (const match of line.matchAll(/(?:var\(\s*|(?:readCssVar|getPropertyValue|cssVar)\(['"`]\s*)(--[\w-]+)/g)) {
      if (decl) add(aliases, match[1], decl);
      else add(used, match[1], location);
    }
    for (const match of line.matchAll(/(?<![\w-])(?:bg|text|border(?:-[tblrxy])?|ring(?:-offset)?|fill|stroke|outline|decoration|accent|caret|shadow|from|via|to|divide(?:-[xy])?|placeholder)-([\w][a-z0-9-]*)/g)) {
      add(utilityRefs, match[1], location);
    }
  }
}

const consumption = [...variables].sort().map((variable) => {
  const traversed = new Set([variable]);
  const queue = [variable];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const next of aliases.get(queue[cursor]) ?? []) {
    if (traversed.has(next)) continue;
    traversed.add(next);
    queue.push(next);
  }
  const direct = [...(used.get(variable) ?? [])];
  const throughAlias = queue.slice(1).flatMap((alias) => [...(used.get(alias) ?? [])]);
  const utilities = queue.filter((key) => key.startsWith('--color-')).map((key) => key.slice(8))
    .flatMap((key) => [...(utilityRefs.get(key) ?? [])]);
  return {
    var: variable, references: direct.length,
    aliasReferences: new Set(throughAlias).size, utilityReferences: new Set(utilities).size,
    aliases: queue.slice(1), examples: [...new Set([...direct, ...throughAlias, ...utilities])].slice(0, 3),
  };
});

const toJson = (key, records, extra = '') => `{\n${extra}  "${key}": [\n${records.map((record) => `    ${JSON.stringify(record)}`).join(',\n')}\n  ]\n}\n`;
if (rest.includes('--write')) {
  const output = (file) => fileURLToPath(new URL(`../../docs/research/evidence/${file}`, import.meta.url));
  writeFileSync(output('style-mutations.json'), toJson('mutations', fields, `  "baselines": ["minimal-light", "minimal-dark", "fully-overridden"],\n`));
  writeFileSync(output('variable-consumers.json'), toJson('variables', consumption, `  "scannedFiles": ${scannedFiles},\n`));
}
console.log(`PASS · ${fields.length} 个路径 × 3 个基线 × 2 轮单变量变异；${variables.size} 个变化的 CSS 变量；静态扫描 ${scannedFiles} 个 UI 源码文件。`);
console.log(`  无 CSS 差异：${fields.filter(({ css }) => !css.length).map(({ path }) => path).join(', ')}`);
console.log(`  无源码变量消费迹象：${consumption.filter((item) => !item.examples.length).length}/${consumption.length}（不等同于字段无效，需核对非 CSS 消费路径）。`);
