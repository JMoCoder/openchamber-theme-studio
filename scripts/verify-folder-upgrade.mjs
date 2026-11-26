// Exercise the user's existing-folder upgrade, including an already-borrowed
// 0.1 theme. The staged folder belongs exclusively to this test instance.
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { approve, bytes, css, footer, json, save, sha, until, waitColor, waitOriginal } from './v-verify-rc2-ui.mjs';

const [name] = process.argv.slice(2);
assert.match(name ?? '', /^ts2-web-upgrade(?:-[a-z0-9]{1,3})?$/u);
const app = await openFixture(name);
const { page, state } = app;
const box = join(repo, '.dev-host/instances', name, 'box');
assert.ok(state.running && state.mode === 'web' && state.defaultDataDir && state.dir === box);
assert.notEqual(new URL(state.url).port, '57123');
const target = join(box, 'extension'), dir = join(state.openchamberData, 'themes');
const old = Object.fromEntries(readFileSync(join(repo, 'docs/research/evidence/package-0.1.0-rc2.sha256'), 'utf8')
  .trim().split('\n').map(line => { const [hash, file] = line.split(/\s+/u); return [file, hash]; }));
const sums = folder => Object.fromEntries(Object.keys(old).map(file => [file, sha(readFileSync(join(folder, file)))]));
const slot = join(dir, 'theme-studio-live-light.json');
const copies = () => ['light', 'dark'].map(v => bytes(join(dir, `theme-studio-upgrade-keep-${v}.json`)));
const report = { fixture: name, beforePackage: old, afterPackage: sums(repo) };
const rendered = {};
try {
  assert.deepEqual(sums(target), old);
  await page.emulateMedia({ colorScheme: 'light' });
  const original = await css(page);
  report.original = original.brief;
  let frame = await approve({ page, state, record() {} });
  const blue = json(join(repo, 'presets/blue-etch-light.json')).colors.primary.base;
  await frame.locator('[data-act=load-preset][data-id=blue-etch]').click();
  await footer(frame, 'Apply').click();
  await waitColor(page, blue, 'light');
  assert.equal(json(slot).themeStudio.borrowedApplied, true);
  const toggle = frame.getByRole('switch', { name: 'Update OpenChamber while editing' });
  assert.equal(await toggle.isChecked(), true);
  await toggle.focus();
  await toggle.press('Space');
  assert.equal(await toggle.isChecked(), false);
  await save(frame, 'Upgrade keep', 'Light and dark');
  const saved = copies(), previous = bytes(slot);
  assert.ok(saved.every(Boolean));
  report.savedBefore = saved;
  for (const file of Object.keys(old)) {
    const dst = join(target, file);
    assert.equal(realpathSync(dst), dst);
    copyFileSync(join(repo, file), dst);
  }
  assert.deepEqual(sums(target), report.afterPackage);
  page.on('response', response => {
    const file = new URL(response.url()).pathname.match(/\/api\/guest-files\/[^/]+\/(panel\/(?:main\.js|style\.css))$/u)?.[1];
    if (file && response.ok()) response.body().then(buf => { rendered[file] = sha(buf); }).catch(() => {});
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await openExtension(page, 'Theme Studio');
  await footer(frame, 'Save to file').waitFor();
  assert.equal(await footer(frame, 'Apply').count(), 0);
  await frame.locator('summary[data-focus=menu]').click();
  const nextToggle = frame.getByRole('switch', { name: 'Live window preview' });
  assert.equal(await nextToggle.isChecked(), false, 'carry forward the old preview preference');
  await nextToggle.focus();
  await nextToggle.press('Space');
  assert.equal(await nextToggle.isChecked(), true);
  await nextToggle.press('Escape');
  assert.deepEqual(bytes(slot), previous, 'opening, using the menu or enabling preview is not an edit');
  assert.equal((await css(page)).brief.primary, blue);
  await frame.locator('[data-act=restore]').click();
  const actual = await waitOriginal(page, original);
  assert.deepEqual(actual.values, original.values);
  assert.equal(json(slot).metadata.id, 'theme-studio-live-light');
  assert.deepEqual(copies(), saved);
  await frame.locator('[data-act=manage-saved][data-id=theme-studio-upgrade-keep]').waitFor();
  await until(() => ['panel/main.js','panel/style.css'].every(f => rendered[f] === report.afterPackage[f]), 'verified 0.2 resources after window reload');
  Object.assign(report, { ok: true, rendered, legacyLivePreference: 'off, then keyboard enabled; no preview write',
    beforeLegacyRestore: previous, restored: actual.brief, savedAfter: copies() });
  writeFileSync(join(repo, 'docs/research/evidence/interactions', `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${name}: existing folder reloaded; old preview preference, named pair and ${actual.brief.variables} original theme values verified`);
} finally { await app.close(); }
