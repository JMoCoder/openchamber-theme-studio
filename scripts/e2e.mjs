#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { openFixture, openExtension, readCss, repo } from './dev-browser.mjs';
import { accentOf, closeAppearance, cssAccent, enterAppearance, observeThemeEvents, removeTheme, showThemeVariant, themeRow, waitAccent } from './workshop-browser.mjs';
import { parseTheme, themeToCssVariables } from '../shared/theme-core.mjs';
import { THEME_CONFIRMATION_TIMEOUT_MS } from '../src/host/live.mjs';

const [name, ...flags] = process.argv.slice(2);
const output = flags.includes('evidence');
const forceWeb = flags.includes('--web-client');
const extensionSource = flags.includes('--extension-source') ? resolve(flags[flags.indexOf('--extension-source') + 1]) : repo;
const setIndex = flags.indexOf('--evidence-set');
const evidenceSet = setIndex < 0 ? '' : flags[setIndex + 1];
if (setIndex >= 0 && (!output || !/^[a-z][a-z0-9-]{0,30}$/u.test(evidenceSet ?? ''))) {
  throw new Error('--evidence-set requires evidence and a short directory label');
}
if (!name?.startsWith('i1-') && !name?.startsWith('qa-')) throw new Error('Use a dedicated isolated --name i1-* or qa-*');
let f = await openFixture(name, { forceWeb });
let { page, state } = f;
assert.equal(state.defaultDataDir, true, 'product uses the default theme directory');
const prefix = !forceWeb && state.mode === 'desktop' ? 'desktop' : 'web';
const evidence = join(repo, 'docs/research/evidence', evidenceSet);
if (output && evidenceSet) await mkdir(evidence, { recursive: true });
const data = state.openchamberData;
const themes = join(data, 'themes');
const downloads = join(state.dir, 'home/下载');
const asciiDownloads = join(state.dir, 'home/Downloads');
const expectedPaths = [join(data, 'settings.json'), join(data, 'preferences.json')];
const key = (path) => path.endsWith('/settings.json') ? 'settings' : 'preferences';
const existed = async (path) => stat(path).then(() => true, (e) => { if (e.code === 'ENOENT') return false; throw e; });
const bytes = async (path) => readFile(path).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
const settings = async () => Object.fromEntries(await Promise.all(expectedPaths.map(async (path) => [key(path), await bytes(path)])));
const tree = async () => Object.fromEntries(await Promise.all((await readdir(themes)).sort()
  .map(async (file) => [file, (await readFile(join(themes, file))).toString('base64')])));
const readTheme = async (id) => JSON.parse(await readFile(join(themes, `${id}.json`), 'utf8'));
const action = (panel, name, id) => panel.locator(`${name === 'apply' ? '.studio-foot ' : ''}[data-act="${name}"]${id ? `[${name === 'variant' ? 'data-value' : 'data-id'}="${id}"]` : ''}`).filter({ visible: true }).first();
const title = 'Theme Studio';
const slot = 'theme-studio-live-light';
const darkSlot = 'theme-studio-live-dark';
const sentinels = ['fixture-unowned-user-light.json', 'fixture-unowned-invalid.json', 'fixture-unowned-not-theme.txt', 'theme-studio-e2e-work-light.json'];
const result = { mode: prefix, hostRuntime: state.mode, extension: 'theme-studio',
  appTimeoutMs: THEME_CONFIRMATION_TIMEOUT_MS, probes: {} };
result.probes.unownedFiles = Object.fromEntries(sentinels.map((name) => [name, 'not-planted']));
let before, beforeThemes, panel, events, peer;
let eventCountBeforeRestart = 0;
const planted = new Map();
const fileDigest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

async function preserveOtherFiles() {
  const template = await readFile(join(repo, 'presets/tidemark-light.json'), 'utf8');
  const native = (filename) => {
    const sample = JSON.parse(template);
    sample.metadata.id = filename.slice(0, -5);
    sample.metadata.name = `Unowned fixture ${sample.metadata.id}`;
    sample.colors.primary.base = '#87528b';
    return `${JSON.stringify(sample)}\n`;
  };
  const samples = [native(sentinels[0]), '{ not valid JSON', 'Synthetic non-theme document.\n', native(sentinels[3])];
  for (const [i, name] of sentinels.entries()) {
    const path = join(themes, name);
    await writeFile(path, samples[i], { flag: 'wx' });
    planted.set(path, { bytes: await readFile(path), mtime: (await stat(path, { bigint: true })).mtimeNs });
    result.probes.unownedFiles[name] = 'planted-not-compared';
  }
}
async function compareOtherFiles() {
  for (const name of sentinels) {
    const path = join(themes, name), expected = planted.get(path);
    if (!expected) continue;
    const actual = await bytes(path);
    result.probes.unownedFiles[name] = !actual ? 'missing'
      : !actual.equals(expected.bytes) ? 'bytes-changed'
      : (await stat(path, { bigint: true })).mtimeNs === expected.mtime ? 'intact' : 'mtime-changed';
  }
  assert.ok(Object.values(result.probes.unownedFiles).every((value) => value === 'intact'), 'file bytes and mtime outside this extension');
}

async function until(check, description) {
  for (let retries = 0; retries < 160; retries++) {
    try { const value = await check(); if (value) return value; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await wait(45);
  }
  throw new Error(description);
}
async function click(name, id) {
  const button = action(panel, name, id);
  if (!(await button.isVisible())) {
    const menu = panel.locator('.studio-menu');
    if (await menu.count() && await menu.getAttribute('open') === null) await menu.locator('summary').click();
  }
  if (prefix === 'web') await button.press('Enter', { timeout: 6500 });
  else await button.click({ timeout: 6500 });
}
async function restartHost() {
  eventCountBeforeRestart += events.count();
  events.stop();
  await peer?.close();
  peer = undefined;
  await f.close();
  const dev = (args) => execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), ...args, '--name', name], { timeout: 45_000 });
  dev(['stop']);
  dev(['start', '--default-data-dir', '--extension', extensionSource, ...(state.mode === 'desktop' ? ['--desktop'] : [])]);
  f = await openFixture(name, { forceWeb });
  ({ page, state } = f);
  assert.equal(await fileDigest(join(state.data, 'extension/panel/main.js')), result.bundleSha256, 'same exact bundle after restart');
  events = await observeThemeEvents(state.url);
  await page.emulateMedia({ colorScheme: 'light' });
  panel = await openExtension(page, title);
}
async function chooseTheme(id, v) {
  await enterAppearance(page);
  await showThemeVariant(page, v);
  await themeRow(page, id).click({ timeout: 7000 });
  await closeAppearance(page);
  panel = await openExtension(page, title);
}
async function selectStudioVariant(v) {
  const button = action(panel, 'variant', v);
  if (await button.getAttribute('aria-selected') !== 'true' && await button.getAttribute('aria-pressed') !== 'true') await click('variant', v);
}
async function expectAccent(color, phase) {
  try { await waitAccent(page, color, state.mode === 'web' ? 36_000 : THEME_CONFIRMATION_TIMEOUT_MS + 1000); }
  catch (error) {
    throw new Error(`${phase}: native color ${color} not observed without reloading`, { cause: error });
  }
}
const dismiss = async () => {
  if (await panel.locator('dialog[open]').count()) await panel.locator('dialog[open]').press('Escape');
};
async function saveBoth(name) {
  await click('save');
  const dialog = panel.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'Theme name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save as', exact: true }).click();
  await dialog.locator('.dialog-outcome .report-file').last().waitFor({ timeout: 9000 }).catch(async (error) => {
    throw new Error(`${error.message}; save UI: ${await dialog.innerText()}`);
  });
  const paths = await dialog.locator('.dialog-outcome code').allTextContents();
  assert.equal(paths.length, 2);
  await dismiss();
  return paths;
}
async function tuneLiveHue(value, before, phase) {
  const started = performance.now();
  await click('tab', 'tune');
  const hue = panel.locator('input[type=range][data-knob=hue][data-knob-group=all]').first();
  await hue.fill(value);
  const updated = await until(async () => {
    const current = await readTheme(slot);
    return accentOf(current) !== before ? current : false;
  }, `${phase}: tuning did not change the live host file`);
  const accent = accentOf(updated);
  await expectAccent(accent, phase);
  await panel.locator('.connection[data-sync="applied"]').waitFor({ timeout: 3500 });
  return { before, after: accent, ms: Math.round(performance.now() - started) };
}
const capture = async (tag) => {
  const file = `workshop-${prefix}-${tag}.jpg`;
  await page.screenshot({ path: join(evidence, file), type: 'jpeg', quality: 68 });
  (result.screenshotsSha256 ??= {})[file] = await fileDigest(join(evidence, file));
};

try {
  assert.equal(await existed(downloads), false, 'must use a fresh dedicated host');
  assert.equal(await existed(asciiDownloads), false);
  assert.deepEqual(Object.keys(await tree()), [], 'must use a fresh dedicated theme directory');
  result.installSource = extensionSource === repo || resolve(extensionSource) === resolve(repo) ? 'repository-root' : 'fixture-package';
  result.stagedPackageSha256 = {};
  for (const file of ['package.json', 'LICENSE', 'NOTICE.md', 'panel/index.html', 'panel/style.css', 'panel/main.js', 'panel/builtins.js']) {
    const digest = await fileDigest(join(state.data, 'extension', file));
    assert.equal(digest, await fileDigest(join(extensionSource, file)), `installed copy: ${file}`);
    result.stagedPackageSha256[file] = digest;
  }
  result.bundleSha256 = result.stagedPackageSha256['panel/main.js'];
  await preserveOtherFiles();
  events = await observeThemeEvents(state.url);
  await page.emulateMedia({ colorScheme: 'light' });
  panel = await openExtension(page, title);
  const connection = panel.locator('.connection');
  // First-open lag is tested without a readiness gate in verify-first-open.mjs.
  // This installed-state regression starts when the initial read has settled.
  await connection.filter({ hasNotText: /^(?:Connecting|Checking theme files)/iu }).waitFor({ timeout: 18_000 });
  assert.match(await connection.innerText(), /panel preview only/i);
  const initial = await cssAccent(page);
  const sampleTheme = JSON.parse(await readFile(join(repo, 'presets/tidemark-light.json'), 'utf8'));
  const paletteKeys = Object.keys(themeToCssVariables(parseTheme(sampleTheme)));
  const readPalette = async () => (await readCss(page, paletteKeys)).style;
  const initialPalette = await readPalette();
  if (forceWeb && state.mode === 'desktop' && flags.includes('--peer')) {
    peer = await openFixture(name);
    await peer.page.emulateMedia({ colorScheme: 'light' });
    await waitAccent(peer.page, initial);
  }
  const appErrors = [];
  const settingWrites = [];
  const sdkErrors = () => panel.locator('body').evaluate(() => globalThis.__fixtureSdkErrors ?? []).catch(() => []);
  await panel.locator('body').evaluate(() => {
    globalThis.__fixtureSdkErrors = [];
    addEventListener('message', ({ data }) => {
      if (data?.channel === 'openchamber.sdk' && data.ok === false) {
        globalThis.__fixtureSdkErrors.push([data.type, data.code]);
      }
    });
  });
  let themeReads = 0;
  page.on('pageerror', (error) => appErrors.push(error.message));
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/api/config/themes') themeReads++;
    if (new URL(req.url()).pathname === '/api/config/settings' && req.method() === 'PUT') {
      try { settingWrites.push(Object.keys(req.postDataJSON()).sort()); } catch {}
    }
  });
  assert.equal(await page.locator('iframe[title="Theme Studio"]').getAttribute('sandbox'), 'allow-scripts');
  beforeThemes = await tree();
  assert.deepEqual(Object.keys(beforeThemes).sort(), [...sentinels].sort());
  await wait(1150); // Allow initial native appearance autosave to settle.
  before = await settings();
  settingWrites.length = 0;

  // Asset delivery is independently verifiable without making the primary
  // channel scenario depend on scrolling both sides of a long catalogue.
  if (prefix === 'desktop' || flags.includes('--verify-builtins')) {
    const asset = page.waitForResponse((response) =>
      /\/builtins\.js(?:[?#]|$)/u.test(response.url()) && response.ok(), { timeout: 6000 });
    await click('toggle-builtins');
    await click('load-builtin', 'flexoki');
    await asset;
    await until(async () => /flexoki/iu.test(await panel.locator('.project-name').inputValue()), 'Lazy palette not loaded');
    await click('load-preset', 'tidemark');
    await until(async () => /tidemark/iu.test(await panel.locator('.project-name').inputValue()), 'Tidemark not loaded');
    result.probes.lazyBuiltinAsset = true;
  }
  const tryStart = performance.now();
  // Independent of when Playwright notices the color: track the frame's real
  // connection state so a false timeout cannot be mistaken for smooth Apply.
  await panel.locator('body').evaluate((root) => {
    const sync = () => root.querySelector('.connection')?.getAttribute('data-sync');
    const states = (globalThis.__fixtureFirstApplySync = [sync()]);
    new MutationObserver(() => {
      const next = sync();
      if (next && states.at(-1) !== next) states.push(next);
    }).observe(root, { attributes: true, attributeFilter: ['data-sync'], childList: true, subtree: true });
  });
  await click('apply');
  const trial = await until(() => readTheme(slot), 'Try-on file not written').catch(async (error) => {
    throw new Error(`${error.message}; pane=${await connection.innerText()}; SDK errors=${JSON.stringify(await sdkErrors())}; page errors=${appErrors.join(', ')}`);
  });
  assert.equal(trial.metadata.id, 'openchamber-light');
  assert.equal(trial.themeStudio.borrowedApplied, true, 'first Apply commits a borrowed theme on disk');
  const trialAccent = accentOf(trial);
  assert.notEqual(trialAccent, initial);
  await expectAccent(trialAccent, 'first-apply').catch(async (error) => {
    const fresh = await fetch(`${state.url}/api/config/themes`).then((r) => r.json());
    const shown = fresh.themes.find((theme) => theme.metadata.id === trial.metadata.id);
    throw new Error(`${error.message}; renderer=${await cssAccent(page)}, server=${shown && accentOf(shown)}, expected=${trialAccent}, browser theme GETs=${themeReads}, server events=${events.count()}, app=${await connection.innerText()}`);
  });
  result.probes.tryonMs = Math.round(performance.now() - tryStart);
  await panel.locator('.connection[data-sync="applied"]').waitFor({ timeout: 3500 });
  result.probes.firstApplySync = await panel.locator('body').evaluate(() => globalThis.__fixtureFirstApplySync);
  if (result.probes.tryonMs < THEME_CONFIRMATION_TIMEOUT_MS) {
    assert.ok(!result.probes.firstApplySync.includes('timeout'), 'confirmation before deadline must not flash a timeout');
  }
  const borrowedPalette = await readPalette();
  if (peer) {
    await waitAccent(peer.page, trialAccent);
    result.probes.sameIdPeerDuringTrial = await cssAccent(peer.page);
  }
  const serverThemes = await fetch(`${state.url}/api/config/themes`).then((r) => r.json());
  const apiTheme = serverThemes.themes.find((theme) => theme.metadata.id === 'openchamber-light');
  result.probes.sidecar = { disk: trial.themeStudio.schemaVersion, response: apiTheme?.themeStudio?.schemaVersion ?? null,
    renderer: await cssAccent(page), errors: appErrors.filter((e) => /theme/i.test(e)) };
  assert.equal((await readTheme(slot)).themeStudio.project.name, trial.themeStudio.project.name);
  if (output) await capture('trial');

  // A saved identical work must not detach a confirmed borrow. Edit without
  // pressing Apply again, then restore the same-colored baseline.
  result.probes.borrowedSaved = await saveBoth('E2E borrowed copy');
  await panel.locator('.connection', { hasText: /applied · in place of/iu }).waitFor({ timeout: 7000 });
  result.probes.postSaveLive = { borrowed: await tuneLiveHue('31', trialAccent, 'edit-after-borrowed-save') };
  await click('revert');
  await expectAccent(trialAccent, 'revert');
  const afterProductEdits = await settings();
  result.probes.productSettingBytesUnchanged = {
    settings: equalBytes(before.settings, afterProductEdits.settings),
    preferences: equalBytes(before.preferences, afterProductEdits.preferences),
  };
  result.probes.hostInitialAutoSaveKeys = settingWrites;
  if (!result.probes.productSettingBytesUnchanged.settings) {
    const old = JSON.parse(before.settings ?? '{}'), newer = JSON.parse(afterProductEdits.settings ?? '{}');
    result.probes.nativeSettingsDiffKeys = [...new Set([...Object.keys(old), ...Object.keys(newer)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(newer[k]));
    assert.ok(state.mode === 'desktop' && result.probes.nativeSettingsDiffKeys.every((k) => k === 'desktopSplashColors'),
      `unexpected settings mutation: ${result.probes.nativeSettingsDiffKeys}`);
    result.probes.nativeDesktopCacheOnly = true;
  }
  assert.equal(result.probes.productSettingBytesUnchanged.preferences, true);

  const returnStart = performance.now();
  await click('end-try-on');
  await until(async () => (await readTheme(slot)).metadata.id === slot, 'Restored slot identity not written');
  await expectAccent(initial, 'restore-identity');
  result.probes.restoreMs = Math.round(performance.now() - returnStart);
  assert.deepEqual(await readPalette(), initialPalette, 'theme variables recover their original computed values');
  result.probes.restoredCssVariableCount = Object.values(initialPalette).filter(Boolean).length;
  result.probes.changedCssVariableCount = paletteKeys.filter((key) => borrowedPalette[key] !== initialPalette[key]).length;
  assert.ok(result.probes.changedCssVariableCount > 1);
  if (peer) {
    await waitAccent(peer.page, initial);
    result.probes.sameIdPeerAfterRestore = await cssAccent(peer.page);
  }
  if (state.mode === 'desktop') {
    const originalCache = JSON.parse(before.settings ?? '{}').desktopSplashColors;
    const currentCache = async () => JSON.parse((await settings()).settings ?? '{}').desktopSplashColors;
    const same = (v) => JSON.stringify(v) === JSON.stringify(originalCache);
    for (let i = 0; i < 15 && !same(await currentCache()); i++) await wait(120);
    result.probes.nativeDesktopCacheRestoredAfterTrial = same(await currentCache());
    assert.equal(result.probes.nativeDesktopCacheRestoredAfterTrial, true);
  }
  result.probes.firstApply = { changedTo: trialAccent, restored: initial, confirmed: true };

  // Restart the actual host and open a fresh panel. A same-frame test
  // shortcut or an extension-local refresh would not prove recovery.
  await click('apply');
  await expectAccent(trialAccent, 'before-restart');
  const beforeRestart = await bytes(join(themes, `${slot}.json`));
  await restartHost();
  await waitAccent(page, trialAccent);
  assert.ok(beforeRestart.equals(await bytes(join(themes, `${slot}.json`))));
  await panel.locator('.connection', { hasText: /applied · in place of/iu }).waitFor({ timeout: 7000 });
  assert.equal(await panel.getByText(/last preview wasn.t applied|previous (preview|try-on)|still trying on|unapplied preview/iu).count(), 0);
  result.probes.restartConfirmed = true;

  // The native picker is independent of the panel. Clearing the borrowed
  // identity must not change the user's newly selected independent theme.
  await chooseTheme('flexoki-light', 'light');
  await waitAccent(page, '#b54f14');
  await panel.getByText(/not (in use|currently in use)|isn.t (currently )?in use/iu).first().waitFor({ timeout: 7000 });
  assert.equal((await readTheme(slot)).metadata.id, 'openchamber-light');
  await click('end-try-on');
  await until(async () => (await readTheme(slot)).metadata.id === slot, 'Borrow not cleared after native theme switch');
  assert.equal((await cssAccent(page)).toLowerCase(), '#b54f14');
  result.probes.switchedAwayAndRestored = true;

  await enterAppearance(page);
  await showThemeVariant(page, 'light');
  const originalRow = themeRow(page, 'openchamber-light');
  await originalRow.waitFor({ timeout: 8000 });
  // The currently selected Flexoki stays visible while the former borrow is
  // removed asynchronously. Wait for the native list, not a meaningless
  // fixed delay or a fresh selection of a row that still represents the borrow.
  await originalRow.getByRole('button', { name: /delete|remove/i }).waitFor({ state: 'hidden', timeout: 36_000 });
  await page.getByRole('radio', { name: 'System', exact: true }).click();
  await chooseTheme('openchamber-dark', 'dark');
  await chooseTheme('openchamber-light', 'light');
  await waitAccent(page, initial);
  result.probes.originalRowAfterSwitchClear = true;
  await selectStudioVariant('light');
  await click('apply');
  await expectAccent(trialAccent, 'reapply-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await waitAccent(page, '#da7c47');
  assert.equal(await existed(join(themes, `${darkSlot}.json`)), false, 'do not borrow the second mode automatically');
  await click('apply-counterpart');
  const dark = await until(async () => {
    const current = await readTheme(darkSlot);
    return current.metadata.id === 'openchamber-dark' ? current : false;
  }, 'Counterpart was not explicitly borrowed');
  assert.equal(dark.themeStudio.borrowedApplied, true);
  await expectAccent(accentOf(dark), 'apply-dark');
  await selectStudioVariant('dark');
  await click('end-try-on');
  await expectAccent('#da7c47', 'restore-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectAccent(trialAccent, 'return-light');
  await selectStudioVariant('light');
  assert.equal((await readTheme(slot)).metadata.id, 'openchamber-light');
  result.probes.systemCounterpart = { explicitlyBorrowed: true, darkRestored: true, lightStillBorrowed: true };

  await click('connect');
  await until(async () => (await readTheme(slot)).metadata.id === slot, 'Long-term slot identity not written');
  await expectAccent(initial, 'long-term-restores-original');
  await enterAppearance(page);
  await showThemeVariant(page, 'light');
  await themeRow(page, slot).click({ timeout: state.mode === 'web' ? 36_000 : 8500 });
  await waitAccent(page, trialAccent);
  await closeAppearance(page);
  panel = await openExtension(page, title);
  await panel.locator('.connection', { hasText: /Connected/iu }).waitFor({ timeout: 8000 }).catch(async (error) => {
    throw new Error(`${error.message}; actual pane=${await panel.locator('.connection').innerText()}`);
  });
  result.probes.convertedToLongTerm = true;
  if (output) await capture('slot');

  result.probes.saved = await saveBoth('E2E work');
  await panel.locator('.connection', { hasText: /Connected/iu }).waitFor({ timeout: 7000 });
  result.probes.postSaveLive.slot = await tuneLiveHue('23', trialAccent, 'edit-after-connected-save');

  await click('export');
  let dialog = panel.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Export files', exact: true }).click();
  await dialog.locator('.dialog-outcome .issue-inline').waitFor();
  assert.equal(await existed(downloads), false);
  assert.equal(await existed(asciiDownloads), false);
  result.probes.noDownloadDirectoryWasCreated = true;
  await dismiss();
  await mkdir(downloads);
  await click('export');
  dialog = panel.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Export files', exact: true }).click();
  const exported = await dialog.locator('.dialog-outcome code').innerText();
  assert.match(exported, /^~\/下载\/openchamber-theme-studio-[a-z0-9-]+\.json$/u);
  result.probes.exported = exported;
  const exportFile = join(downloads, exported.split('/').at(-1));
  const exportData = await readFile(exportFile);
  assert.equal(JSON.parse(exportData).themeStudio.project.name, trial.themeStudio.project.name);
  await dismiss();

  await click('import');
  dialog = panel.locator('dialog[open]');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: exportData });
  await dialog.getByText(/Theme imported/i).waitFor({ timeout: 6000 });
  result.probes.imported = true;
  await dismiss();

  await enterAppearance(page);
  await showThemeVariant(page, 'light');
  await themeRow(page, 'openchamber-light').click();
  await waitAccent(page, initial);
  const savedIds = [...result.probes.borrowedSaved, ...result.probes.saved].map((file) => file.split('/').at(-1).replace(/\.json$/u, ''));
  for (const id of [slot, darkSlot, ...savedIds]) {
    await showThemeVariant(page, id.endsWith('-dark') ? 'dark' : 'light');
    await removeTheme(page, id);
    await until(async () => !await existed(join(themes, `${id}.json`)), `Native delete did not remove ${id}`);
  }
  await rm(exportFile);
  await rm(downloads, { recursive: true });
  await compareOtherFiles();
  assert.deepEqual(await tree(), beforeThemes);
  result.probes.themeDirectoryBytesRestored = true;
  result.probes.rendererErrors = appErrors;
  result.probes.watcherEvents = events.count() + eventCountBeforeRestart;
  await closeAppearance(page);
  await wait(1000);
  const nativeEnd = await settings();
  result.probes.nativeSettingsChangedBytes = Object.fromEntries(Object.keys(before).map((k) => [k, !equalBytes(before[k], nativeEnd[k])]));
} catch (error) {
  result.incomplete = error.message;
  if (output) await writeFile(join(evidence, `workshop-${prefix}-e2e.partial.json`), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  events?.stop();
  await peer?.close().catch(() => {});
  await f.close();
  // Guarded PID shutdown. Native settings clicks may legitimately change the
  // fixture profile; no product path may touch those files.
  execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), 'stop', '--name', name]);
  if (before) {
    for (const path of expectedPaths) {
      const original = before[key(path)];
      if (original === null) await rm(path, { force: true }); else await writeFile(path, original);
    }
    const after = await settings();
    assert.deepEqual(after, before, 'isolated profile bytes restored');
    result.probes.fixtureSettingsBytesRestored = true;
  }
  for (const path of planted.keys()) await rm(path, { force: true });
}
if (output) await writeFile(join(evidence, `workshop-${prefix}-e2e.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function equalBytes(a, b) {
  return a === null || b === null ? a === b : a.equals(b);
}
