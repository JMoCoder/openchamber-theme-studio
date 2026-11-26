#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeKey } from '../src/host/identify.mjs';
import { parseTheme } from '../shared/theme-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '30c70496a5ca0105e04e60a783964576973edc8f';
const source = resolve(process.argv[2] ?? process.env.OPENCHAMBER_SOURCE ?? 'CHANGE-ME');
const files = 'packages/ui/src/lib/theme/themes';
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' });
assert.equal(git('rev-parse', 'refs/tags/v2.8.0^{commit}').trim(), revision, '需要官方 v2.8.0 标签');
const readPinned = (path) => git('show', `${revision}:${path}`);
const names = git('ls-tree', '--name-only', revision, `${files}/`).trim().split('\n')
  .filter((path) => path.endsWith('.json')).sort();
const themes = {}, pairs = new Map();
for (const path of names) {
  const definition = JSON.parse(readPinned(path));
  const { metadata: { id, name, variant }, colors } = parseTheme(definition);
  const family = id.replace(/-(light|dark)(?:-\1)?$/u, '');
  assert.ok(!Object.hasOwn(themes, id) && ['light', 'dark'].includes(variant), `无效 ID/变体 ${id}`);
  themes[id] = definition;
  let card = pairs.get(family);
  if (!card) {
    card = { id: family, slug: family, name: name.replace(/\s*(?:\(?(?:Light|Dark)\)?)$/iu, ''), ids: [], variants: {} };
    pairs.set(family, card);
  }
  assert.ok(!card.variants[variant]);
  card.ids.push(id);
  card.variants[variant] = {
    id, name, key: themeKey(definition), source: basename(path),
    swatches: { canvas: colors.surface.background, primary: colors.primary.base, elevated: colors.surface.elevated,
      sidebar: colors.surface.muted, edge: colors.interactive.border, syntax: Object.values(colors.syntax.base).slice(0, 4) },
  };
}
const index = [...pairs.values()];
assert.equal(names.length, 62);
assert.equal(index.length, 31);
assert.ok(index.every(({ variants }) => variants.light && variants.dark));
const counts = new Map();
for (const { variants } of index) for (const [variant, { key, id }] of Object.entries(variants)) {
  const token = `${variant}:${key}`;
  counts.set(token, [...(counts.get(token) ?? []), id]);
}
const collisions = [...counts.values()].filter((ids) => ids.length > 1);
const out = join(root, 'src/data');
mkdirSync(out, { recursive: true });
mkdirSync(join(root, 'panel'), { recursive: true });
writeFileSync(join(out, 'builtin-index.json'), `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(join(out, 'builtin-defaults.json'), `${JSON.stringify({
  light: themes['openchamber-light'], dark: themes['openchamber-dark'],
})}\n`);
writeFileSync(join(root, 'panel/builtins.js'),
  `/* OpenChamber v2.8.0 ${revision}; MIT, see NOTICE.md. Generated; do not edit. */\n` +
  `globalThis.__themeStudioBuiltins = ${JSON.stringify(themes)};\n`);
console.log(JSON.stringify({ revision, themes: names.length, pairs: index.length, unique: counts.size, collisions }));
