#!/usr/bin/env node
// Independent UI acceptance. Use only with newly staged v-26e11-* fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { openFixture, openExtension, repo } from './dev-browser.mjs';

const [name, task] = process.argv.slice(2);
assert.match(name ?? '', /^v-26e11-(?:[dwrfc]|w(?:[2-9]|1\d))$/u);
const SHIPPED = 'cc675cff444f6d38e137ee5cae2cac8fe00ce16439d219ac3baa3d2696cb14cd';
const title = 'Theme Studio';
const short = (snapshot, match, max = 32) => snapshot.split('\n').filter((line) => match.test(line)).slice(0, max);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const evidence = join(repo, 'docs/research/evidence');
const out = join(evidence, `v-verify-${name.replace(/^v-26e11-/u, '')}.json`);
const data = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { name, observations: [] };
const append = (stage, fields = {}) => {
  data.observations.push({ stage, ...fields });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(stage, JSON.stringify(fields).slice(0, 220));
};
const manifest = Object.fromEntries(readFileSync(join(evidence, 'package-0.1.0.sha256'), 'utf8')
  .trim().split('\n').map((line) => line.split('  ').reverse()));
function hashes(dir) {
  return Object.fromEntries(Object.keys(manifest).map((path) => [path, sha(readFileSync(join(dir, path)))]));
}
function btn(root, name) { return root.getByRole('button', { name, exact: true }); }
async function closeSettings(page) {
  const close = btn(page, 'Close settings');
  await close.click();
  await close.waitFor({ state: 'hidden' });
}
async function settings(page, section) {
  const close = btn(page, 'Close settings');
  if (!await close.isVisible()) await btn(page, 'Settings').click();
  const heading = page.getByRole('heading', { name: section, exact: true });
  if (!await heading.isVisible()) await btn(page, section).click();
  await heading.waitFor();
}
async function add(page) {
  await settings(page, 'Extensions');
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await btn(page, /^Add extension Folder/).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  return review(page);
}
async function review(page) {
  const dialog = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  await dialog.waitFor();
  const a = await dialog.ariaSnapshot();
  assert.match(a, /Theme Studio v0\.1\.0 wants to/u);
  assert.match(a, /~\/\.config\/openchamber\/themes\/theme-studio-\*\.json/u);
  append('native-permission-prompt', { source: '/lab/extension', prompt: a.split('\n') });
  return dialog;
}
async function approve(page) {
  await btn(await add(page), 'Allow and enable').click();
  await closeSettings(page);
  const frame = await openExtension(page, title);
  await frame.getByRole('tab', { name: 'Theme', exact: true }).waitFor();
  const iframe = page.locator(`iframe[title="${title}"]`);
  const trigger = page.locator('[data-context-surface^="plugin:"]').and(btn(page, title));
  const [box, win] = await Promise.all([iframe.boundingBox(), page.evaluate(() => ({ width: innerWidth, height: innerHeight }))]);
  const surface = await trigger.getAttribute('data-context-surface');
  assert.ok(box.x + box.width > win.width * 0.9 && box.y < win.height * 0.4);
  const workStatus = btn(page, 'Toggle work-status panel');
  const statusBefore = await workStatus.getAttribute('aria-pressed');
  await workStatus.click();
  const statusAfter = await workStatus.getAttribute('aria-pressed');
  const relevantButtons = await btn(page, title).count();
  assert.equal(relevantButtons, 1);
  assert.equal(await iframe.count(), 1);
  await workStatus.click();
  append('native-approval-then-right-sidebar', { surface, box, window: win, statusBefore, statusAfter, themeStudioButtons: relevantButtons });
  return frame;
}
async function css(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const computed = getComputedStyle(html);
    const colored = Array.from(computed).filter((key) => /^--(?:primary-|surface-|syntax-|chat-|status-|tools-|sidebar-|markdown-|interactive-|pr-)/u.test(key));
    const keys = new Set(['--primary-base', '--background', '--foreground', '--font-sans', '--font-mono', '--radius', ...colored, ...html.style]);
    return {
      mode: html.getAttribute('data-theme'),
      media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      values: Object.fromEntries([...keys].filter((key) => key.startsWith('--')).sort()
        .map((key) => [key, computed.getPropertyValue(key).trim()])),
    };
  });
}
function changes(before, after) {
  return [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])]
    .filter((key) => before.values[key] !== after.values[key]);
}
function cssBrief(s) {
  return { mode: s.mode, media: s.media, variables: Object.keys(s.values).length, sha: sha(JSON.stringify(s.values)),
    primary: s.values['--primary-base'], bg: s.values['--background'],
    radius: s.values['--radius'], bodyFont: s.values['--font-sans'], monoFont: s.values['--font-mono'] };
}
const read = (path) => existsSync(path) ? readFileSync(path) : null;
const parse = (raw) => raw ? JSON.parse(raw.toString()) : null;
const configSnapshot = (dir) => Object.fromEntries(['settings.json', 'preferences.json']
  .map((key) => [key, read(join(dir, key))]));
function configDiff(before, after) {
  return Object.fromEntries(Object.keys(before).map((name) => {
    const a = parse(before[name]) ?? {};
    const b = parse(after[name]) ?? {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    return [name, { keys, before: before[name] && sha(before[name]), after: after[name] && sha(after[name]) }];
  }));
}
function themePreferences(snapshot) {
  const keys = ['themeVariant', 'themeId', 'lightThemeId', 'darkThemeId', 'useSystemTheme'];
  const readTheme = (fields) => Object.fromEntries(keys.filter((key) => Object.hasOwn(fields, key)).flatMap((key) => {
    const entry = fields[key];
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    return value == null || ['string', 'boolean'].includes(typeof value) ? [[key, value ?? null]] : [];
  }));
  return { settings: readTheme(parse(snapshot['settings.json']) ?? {}),
    preferences: readTheme(parse(snapshot['preferences.json'])?.fields ?? {}) };
}
function disk(path) {
  const raw = read(path);
  return raw && { sha: sha(raw), bytes: raw.length, mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString() };
}
function directory(dir) {
  return Object.fromEntries(readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
    .map((file) => [file, disk(join(dir, file))]));
}
async function until(check, description, ms = 35_000) {
  const start = performance.now();
  do {
    const value = await check();
    if (value) return value;
    await wait(90);
  } while (performance.now() - start < ms);
  throw new Error(`Not observed: ${description}`);
}
async function waitCss(page, predicate, description) {
  return until(async () => {
    const now = await css(page);
    return predicate(now) && now;
  }, description);
}
const primary = (s) => s.values['--primary-base'];
const detail = (frame) => frame.locator('body').ariaSnapshot();
async function remove(page) {
  await settings(page, 'Extensions');
  await btn(page, /Theme Studio Folder · v0\.1\.0/u).click();
  await btn(page, 'Remove Theme Studio').click();
  const confirm = btn(page, 'Remove');
  if (await confirm.waitFor({ state: 'visible', timeout: 1200 }).then(() => true, () => false)) await confirm.click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeSettings(page);
  assert.equal(await page.locator(`iframe[title="${title}"]`).count(), 0);
  assert.equal(await page.locator('[data-context-surface^="plugin:"]').and(btn(page, title)).count(), 0);
  append('native-uninstall', { extensions: 'No extensions loaded', iframe: 'absent', sidebar: 'absent' });
}
async function denied(page) {
  // The separate rejection fixture was first added without approval while surveying
  // native controls. This also supports a fresh fixture start for repeatability.
  await settings(page, 'Extensions');
  const pending = btn(page, /Needs approval Theme Studio/u);
  const dialog = await pending.isVisible() ? (await pending.click(),
    await btn(page, 'Review what Theme Studio asks for').click(), await review(page)) : await add(page);
  await btn(dialog, 'Not now').click();
  if (!await pending.isVisible()) await btn(page, 'Back to extensions').click();
  await pending.waitFor();
  await closeSettings(page);
  assert.equal(await page.locator('[data-context-surface^="plugin:"]').and(btn(page, title)).count(), 0);
  assert.equal(await page.locator(`iframe[title="${title}"]`).count(), 0);
  append('native-not-now-no-panel', { extensionCard: 'Needs approval', panel: 'not mounted' });
  await remove(page);
}
const tab = (frame, name) => frame.getByRole('tab', { name, exact: true });
const mainBtn = (frame, name) => btn(frame.locator('footer'), name);
const sample = (frame) => frame.getByRole('group', { name: 'Preview samples' });
const preview = (frame) => sample(frame).evaluate((el) => {
  const s = getComputedStyle(el);
  return ['--v-primary', '--v-background', '--v-border', '--v-syntax-keyword'].map((key) => s.getPropertyValue(key).trim());
});
async function choose(frame, set, recipe) {
  const guide = btn(frame, 'Dismiss getting started');
  if (await guide.isVisible()) await guide.click();
  await tab(frame, 'Theme').click();
  await btn(frame, `Use ${set}`).click();
  await tab(frame, 'Style').click();
  const before = await preview(frame);
  await btn(frame, `Use ${recipe}`).click();
  const after = await preview(frame);
  assert.notDeepEqual(after, before);
  await frame.getByText('Out of reach', { exact: true }).waitFor();
  return { set, recipe, before, after };
}
async function accent(frame, color) {
  const hex = frame.getByRole('textbox', { name: 'HEX', exact: true });
  if (!await hex.isVisible()) await btn(frame, 'Auto accept: Accent').click();
  await hex.fill(color);
  await hex.press('Enter');
  await until(async () => (await preview(frame))[0].toLowerCase() === color, `preview accent ${color}`, 2500);
}
function lane(path) {
  const value = parse(read(path));
  return value && { ...disk(path), id: value.metadata.id, name: value.metadata.name, variant: value.metadata.variant,
    primary: value.colors.primary.base, rev: value.themeStudio?.rev,
    writer: value.themeStudio?.writer ? sha(value.themeStudio.writer).slice(0, 10) : null,
    confirmed: value.themeStudio?.borrowedApplied ?? false };
}
async function apply(page, frame, path, before) {
  const button = mainBtn(frame, 'Apply');
  await button.waitFor();
  const beforeStatus = await frame.locator('.connection').textContent();
  const draft = await preview(frame);
  const start = performance.now();
  const previous = lane(path);
  await button.click();
  const written = await until(() => {
    const next = lane(path);
    return next?.sha !== previous?.sha && next;
  }, 'applied theme file on disk');
  append('apply-button-and-actual-write', { control: 'Apply', beforeStatus, draft, file: written });
  if (written.id === `theme-studio-live-${before.mode}` && previous?.id !== written.id) {
    const native = await css(page);
    if (primary(native) !== written.primary) {
      const controls = short(await detail(frame), /Choose in Appearance|Try in the app|status:|alert/u);
      append('apply-prepared-slot-instead-of-borrow', { controls, file: written, css: cssBrief(native) });
      assert.fail('Enabled Apply presented with the native built-in, but it wrote a personal slot and did not change the app');
    }
  }
  const received = await waitCss(page, (s) => s.mode === before.mode && primary(s) === written.primary, 'applied theme rendered in the app');
  assert.ok(changes(before, received).length > 0);
  return { ms: Math.round(performance.now() - start), css: cssBrief(received), file: written, changed: changes(before, received).length };
}
async function restore(page, frame, path, before) {
  await btn(frame, 'Restore original theme').click();
  const file = await until(() => {
    const info = lane(path);
    return info?.id === `theme-studio-live-${before.mode}` && info;
  }, 'temporary theme reverted to its own slot identity');
  const restored = await waitCss(page, (s) => s.mode === before.mode && primary(s) === primary(before), 'original theme value restored');
  assert.deepEqual(restored.values, before.values);
  return { css: cssBrief(restored), file };
}
async function variantInAppearance(page, mode) {
  await settings(page, 'Appearance');
  const themes = page.getByRole('group', { name: 'Themes', exact: true });
  await btn(themes, mode === 'light' ? 'Light' : 'Dark').click();
  return page.getByRole('listbox', { name: `${mode === 'light' ? 'Light' : 'Dark'} theme`, exact: true });
}
async function nativeTheme(page, mode, name, id = null) {
  const list = await variantInAppearance(page, mode);
  const option = id ? list.locator(`[data-theme-id="${id}"][role=option]`) : list.getByRole('option', { name, exact: true });
  if (id) assert.ok((await option.textContent()).includes(name));
  await option.click();
  await until(async () => (await option.getAttribute('aria-selected')) === 'true', `native selected ${name}`, 2500);
  await closeSettings(page);
}
async function nativeDelete(page, dir, theme) {
  const list = await variantInAppearance(page, theme.variant);
  const row = list.locator(`[data-theme-id="${theme.id}"]`);
  await btn(row, /delete|remove/iu).click();
  const confirm = btn(page, /^(Delete|Remove)$/u).filter({ visible: true });
  if (await confirm.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)) await confirm.click();
  const path = join(dir, `${theme.id}.json`);
  await until(() => !existsSync(path), `native Appearance removed ${theme.id}`);
}
async function changeMode(page, mode) {
  await page.emulateMedia({ colorScheme: mode });
  return waitCss(page, (actual) => actual.mode === mode && actual.media === mode, `system appearance ${mode}`);
}
async function editorMode(frame, mode) {
  const group = frame.getByRole('group', { name: 'Edit theme variant' });
  const option = btn(group, mode === 'light' ? 'Light' : 'Dark');
  if (await option.getAttribute('aria-pressed') !== 'true') {
    await option.click();
    await until(async () => (await option.getAttribute('aria-pressed')) === 'true', `panel switches to ${mode} through its visible variant button`, 5500);
  }
}
async function snapshotImage(page, label) {
  const file = `v-verify-${label}.jpg`;
  const raw = await page.screenshot({ path: join(evidence, file), type: 'jpeg', quality: 78 });
  append('screenshot', { file, sha: sha(raw) });
}
async function openMenu(frame, name) {
  await frame.locator('summary[aria-label="Theme actions"]').click();
  await btn(frame, name).click();
}
async function save(frame, name, variant = 'Light') {
  await mainBtn(frame, 'Save as').click();
  const dialog = frame.getByRole('dialog', { name: 'Save as', exact: true });
  await dialog.getByRole('textbox', { name: 'Theme name' }).fill(name);
  await dialog.getByRole('combobox', { name: 'Choose which variants to save' }).selectOption({ label: variant });
  await btn(dialog, 'Save as').click();
  await dialog.getByText('Saved', { exact: true }).waitFor();
  const info = await dialog.ariaSnapshot();
  await btn(dialog, 'Done').click();
  return info.split('\n').filter((line) => line.includes('~/.config/openchamber/themes/'));
}
async function exportTheme(frame) {
  await openMenu(frame, 'Export files');
  const dialog = frame.getByRole('dialog', { name: 'Export files', exact: true });
  await dialog.getByRole('combobox', { name: 'Choose which variants to save' }).selectOption({ label: 'Light' });
  await btn(dialog, 'Export files').click();
  await dialog.getByText('Exported', { exact: true }).waitFor();
  const info = await dialog.ariaSnapshot();
  await btn(dialog, 'Done').click();
  return info.split('\n').filter((line) => line.includes('~/Downloads/'));
}
async function importTheme(frame, path, outcome) {
  await openMenu(frame, 'Import a theme');
  const dialog = frame.getByRole('dialog', { name: 'Import OpenChamber theme', exact: true });
  await dialog.locator('input[type="file"]').setInputFiles(path);
  await dialog.getByText(outcome, { exact: true }).waitFor();
  const info = await dialog.ariaSnapshot();
  if (await btn(dialog, 'Done').isVisible()) await btn(dialog, 'Done').click();
  else await btn(dialog, 'Close').click();
  return info;
}
function recordBaseline(state, dir, base, other = {}) {
  const before = configSnapshot(state.openchamberData);
  append('initial-state-before-product-actions', { host: cssBrief(base), files: directory(dir),
    nativeConfig: configDiff(before, before), ...other });
  return before;
}
async function desktop(page, frame, state) {
  const dir = join(state.openchamberData, 'themes');
  const path = join(dir, 'theme-studio-live-light.json');
  const initialFiles = directory(dir);
  assert.deepEqual(initialFiles, {});
  const base = await css(page);
  const config = recordBaseline(state, dir, base);
  const recipe = await choose(frame, 'Blue Etch', 'Brutalism');
  assert.deepEqual((await css(page)).values, base.values);
  assert.deepEqual(directory(dir), initialFiles);
  append('desktop-draft-only', recipe);
  const applied = await apply(page, frame, path, base);
  assert.ok(applied.file.confirmed);
  assert.notEqual(applied.file.id, 'theme-studio-live-light');
  append('desktop-whole-window-applied', applied);
  const withPreview = await until(() => {
    const next = configSnapshot(state.openchamberData);
    return configDiff(config, next)['settings.json'].keys.includes('desktopSplashColors') && next;
  }, 'desktop host persisted its splash color cache', 8000);
  append('desktop-config-while-borrowed', configDiff(config, withPreview));
  await snapshotImage(page, 'desktop-applied');
  append('desktop-original-restored', await restore(page, frame, path, base));
  const automaticallyRestored = await until(() => {
    const next = configSnapshot(state.openchamberData);
    return !configDiff(config, next)['settings.json'].keys.includes('desktopSplashColors') && next;
  }, 'desktop erased its splash cache difference through normal restore', 8000);
  append('desktop-config-after-normal-restore', configDiff(config, automaticallyRestored));
  await nativeDelete(page, dir, lane(path));
  await closeSettings(page);
  assert.deepEqual(directory(dir), initialFiles);
  await remove(page);
  append('desktop-final-state', { css: cssBrief(await css(page)), files: directory(dir),
    nativeConfig: configDiff(config, configSnapshot(state.openchamberData)),
    controllerRewroteNativeConfig: false });
}
async function degradation(page, frame, state) {
  const dir = join(state.openchamberData, 'themes');
  const expected = join(state.dir, 'home/.config/openchamber/themes');
  assert.equal(existsSync(expected), false);
  const base = await css(page);
  const files = directory(dir);
  await frame.getByText('Panel preview only · no file access', { exact: true }).waitFor();
  const recipe = await choose(frame, 'Kilnmark', 'Editorial Paper');
  const button = mainBtn(frame, 'Copy JSON');
  await button.click();
  const manual = frame.getByRole('dialog', { name: 'Copy JSON manually', exact: true });
  let payload;
  let route;
  if (await manual.waitFor({ timeout: 1200 }).then(() => true, () => false)) {
    const textarea = manual.locator('textarea[readonly]');
    const selection = await textarea.evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
    assert.deepEqual(selection, [0, selection[2], selection[2]]);
    payload = await textarea.inputValue();
    await btn(manual, 'Done').click();
    route = 'manual JSON, readonly and selected';
  } else {
    await frame.getByText('JSON copied', { exact: true }).waitFor();
    await fixture.context.grantPermissions(['clipboard-read'], { origin: state.url });
    payload = await page.evaluate(() => navigator.clipboard.readText());
    route = 'Chromium clipboard';
  }
  const def = JSON.parse(payload);
  assert.ok(def.colors.primary.base);
  assert.deepEqual((await css(page)).values, base.values);
  assert.deepEqual(directory(dir), files);
  assert.equal(existsSync(expected), false);
  assert.equal(await mainBtn(frame, 'Apply').count(), 0);
  assert.ok(!await mainBtn(frame, 'Save as').isEnabled());
  append('alternate-data-real-panel-degraded', { recipe, route, exportedVariant: def.metadata.variant,
    bytes: Buffer.byteLength(payload), nativeCSSUnchanged: true, filesUnchanged: true, defaultThemeDirectoryCreated: false });
  await remove(page);
}
async function fixedName(page, state) {
  const dir = join(state.openchamberData, 'themes');
  const path = join(dir, 'theme-studio-live-light.json');
  const original = parse(read(join(repo, 'presets/reed-shade-light.json')));
  delete original.themeStudio;
  original.metadata.id = 'theme-studio-live-light';
  original.metadata.name = 'Independent unmarked slot';
  fixtureFile(path, original);
  const preserved = disk(path);
  const frame = await approve(page);
  await frame.getByText('Theme changed somewhere else', { exact: true }).waitFor();
  const baseline = await css(page);
  const recipe = await choose(frame, 'Blue Etch', 'Brutalism');
  assert.ok(!await mainBtn(frame, 'Apply').isEnabled());
  assert.deepEqual(directory(dir), { 'theme-studio-live-light.json': preserved });
  assert.deepEqual((await css(page)).values, baseline.values);
  append('fixed-slot-name-collision-safely-blocked', { existing: preserved, marked: false,
    status: 'Theme changed somewhere else', applyDisabled: true, draftPreviewChanges: recipe.after, originalUnchanged: true });
  await remove(page);
  assert.deepEqual(directory(dir), { 'theme-studio-live-light.json': preserved });
}
async function webFirst(page, frame, state, part = 'all') {
  const dir = join(state.openchamberData, 'themes');
  const light = join(dir, 'theme-studio-live-light.json');
  const dark = join(dir, 'theme-studio-live-dark.json');
  const webStart = await css(page);
  const config = recordBaseline(state, dir, webStart);
  const peer = ['main', 'first-click'].includes(part) ? null : await openFixture(state.name ?? name);
  try {
    if (peer) {
      peer.page.setDefaultTimeout(7000);
      assert.notEqual(peer.browser, fixture.browser);
      const peerBase = await css(peer.page);
      assert.deepEqual(peerBase.values, webStart.values);
    }
    const recipe = await choose(frame, 'Wheat Vellum', 'Brutalism');
    await tab(frame, 'Pairings').click();
    await frame.getByRole('heading', { name: 'What a theme can’t change', exact: true }).waitFor();
    const families = frame.getByRole('combobox', { name: /Try a family installed on this device/ });
    assert.equal(await families.count(), 2);
    const familyNames = await families.evaluateAll((els) => els.map((el) => el.value));
    const snippet = frame.locator('.font-sample').first();
    const fontBefore = await snippet.evaluate((el) => getComputedStyle(el).fontFamily);
    await families.first().fill('serif');
    const fontAfter = await snippet.evaluate((el) => getComputedStyle(el).fontFamily);
    assert.notEqual(fontBefore, fontAfter);
    assert.match(fontAfter, /\bserif\b/u);
    const pairingConfig = configDiff(config, configSnapshot(state.openchamberData));
    assert.deepEqual((await css(page)).values, webStart.values);
    assert.deepEqual(directory(dir), {});
    assert.deepEqual(pairingConfig['settings.json'].keys, []);
    assert.deepEqual(pairingConfig['preferences.json'].keys, []);
    append('web-preview-style-boundary-and-font-pairing', { ...recipe, families: familyNames, fontSample: { before: fontBefore, after: fontAfter },
      nativeCSSUnchanged: true, nativeSettingsUnchanged: true, noThemeFile: true });
    if (part !== 'first-click') await btn(frame, 'Try in the app').waitFor();
    const applied = await apply(page, frame, light, webStart);
    assert.ok(applied.file.confirmed);
    assert.notEqual(applied.file.id, 'theme-studio-live-light');
    assert.deepEqual([applied.css.radius, applied.css.bodyFont, applied.css.monoFont],
      [cssBrief(webStart).radius, cssBrief(webStart).bodyFont, cssBrief(webStart).monoFont]);
    if (!peer) {
      append('web-single-client-whole-window-applied', applied);
      if (part === 'first-click') {
        append('web-fresh-first-click-restore', await restore(page, frame, light, webStart));
        await nativeDelete(page, dir, lane(light));
        await closeSettings(page);
        await remove(page);
        return;
      }
      await accent(frame, '#336982');
      await waitCss(page, (s) => primary(s) === '#336982', 'an ordinary live color edit reaches the native app');
      await mainBtn(frame, 'Revert').click();
      const baseline = await waitCss(page, (s) => primary(s) === applied.file.primary, 'revert to last applied draft');
      assert.equal(lane(light).primary, applied.file.primary);
      assert.deepEqual(cssBrief(baseline), applied.css);
      append('web-revert-draft-not-original', { css: cssBrief(baseline), disk: lane(light) });
      await snapshotImage(page, 'web-applied');
      await webFilesAndCleanup(page, frame, null, state, { webStart, light, dark, dir, config });
      return;
    }
    const peerApplied = await waitCss(peer.page, (s) => primary(s) === applied.file.primary, 'other real client sees same borrowed theme');
    assert.deepEqual(cssBrief(peerApplied), applied.css);
    append('web-same-server-same-native-id', { id: applied.file.id, first: applied, second: cssBrief(peerApplied),
      nativeConfig: configDiff(config, configSnapshot(state.openchamberData)) });
    const second = await openExtension(peer.page, title);
    await second.getByText(/^(Applied · in place of|Previewing in place of)/).waitFor();
    const switcher = second.getByRole('switch', { name: 'Update OpenChamber while editing', exact: true });
    if (await switcher.isChecked()) await second.locator('label:has(input[data-change="live"]) .switch-art').click();
    await until(async () => !await switcher.isChecked(), 'second panel Live switch is unchecked', 2500);
    await accent(second, '#a65b13');
    assert.equal(primary(await css(peer.page)), applied.file.primary);
    assert.deepEqual(lane(light), applied.file);
    await accent(frame, '#245fb7');
    await Promise.all([waitCss(page, (s) => primary(s) === '#245fb7', 'first panel live edit'),
      waitCss(peer.page, (s) => primary(s) === '#245fb7', 'second client sees first panel live edit')]);
    const firstEdit = lane(light);
    const applyStale = second.locator('footer .footer-apply');
    let attempt = 'Live turned off so stale draft preserved locally; proactive conflict blocked Apply';
    if (await applyStale.isEnabled()) {
      await applyStale.click();
      attempt = 'Explicit stale Apply';
    }
    await second.getByText('Theme changed somewhere else', { exact: true }).waitFor();
    assert.deepEqual(lane(light), firstEdit);
    assert.equal(primary(await css(page)), firstEdit.primary);
    assert.equal((await preview(second))[0], '#a65b13');
    append('web-stale-panel-write-conflict', { firstEdit, secondDraft: (await preview(second))[0],
      diskUnchanged: true, attempt, source: 'two independent Chromium clients using standalone Web' });
    await btn(second, 'Load their changes').first().click();
    await until(async () => (await preview(second))[0] === firstEdit.primary, 'second user explicitly loads the other version');
    await nativeTheme(peer.page, 'light', 'Flexoki');
    const newTheme = await waitCss(peer.page, (s) => primary(s) !== firstEdit.primary, 'second user selects another real theme');
    await accent(frame, '#336982');
    const after = await waitCss(page, (s) => primary(s) === '#336982', 'further borrow propagates to first client');
    assert.deepEqual((await css(peer.page)).values, newTheme.values);
    append('web-different-id-unaffected', { first: cssBrief(after), second: cssBrief(newTheme), secondNativeTheme: 'Flexoki' });
    if (part === 'two') {
      const restored = await restore(page, frame, light, webStart);
      assert.deepEqual((await css(peer.page)).values, newTheme.values);
      append('web-two-client-restore-protects-other-theme', { first: restored, second: cssBrief(newTheme) });
      await nativeTheme(peer.page, 'light', 'OpenChamber');
      await nativeDelete(page, dir, lane(light));
      await closeSettings(page);
      await remove(page);
      assert.deepEqual(directory(dir), {});
      return;
    }
    await mainBtn(frame, 'Revert').click();
    const baseline = await waitCss(page, (s) => primary(s) === applied.file.primary, 'revert to last applied draft');
    assert.equal(lane(light).primary, applied.file.primary);
    assert.deepEqual(cssBrief(baseline), applied.css);
    append('web-revert-draft-not-original', { css: cssBrief(baseline), disk: lane(light) });
    await snapshotImage(page, 'web-applied');
    await webFilesAndCleanup(page, frame, peer.page, state, { webStart, light, dark, dir, config });
  } finally { await peer?.close(); }
}
function fixtureFile(path, doc) {
  const temporary = `${path}.v-verify-tmp`;
  assert.equal(existsSync(path), false);
  writeFileSync(temporary, typeof doc === 'string' ? doc : `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}
async function webFilesAndCleanup(page, frame, peer, state, { webStart, light, dark, dir, config }) {
  const downloads = join(state.dir, 'home/Downloads');
  mkdirSync(downloads, { mode: 0o700 });
  const collision = join(dir, 'theme-studio-independent-archive-light.json');
  const foreign = parse(read(light));
  delete foreign.themeStudio;
  foreign.metadata.id = 'theme-studio-independent-archive-light';
  foreign.metadata.name = 'Independent original (unmanaged)';
  foreign.colors.primary.base = '#276e58';
  fixtureFile(collision, foreign);
  const protectedBefore = disk(collision);
  const saveReport = await save(frame, 'Independent Archive', 'Light and dark');
  const savedPaths = ['light', 'dark'].map((mode) => join(dir, `theme-studio-independent-archive-2-${mode}.json`));
  const saved = savedPaths.map(lane);
  assert.ok(saved.every(Boolean));
  assert.deepEqual(disk(collision), protectedBefore);
  append('web-save-as-collision-kept-existing-file', { report: saveReport, files: saved, originalBefore: protectedBefore,
    originalAfter: disk(collision), originalHasStudioMarker: false });
  await accent(frame, '#824779');
  const edited = await waitCss(page, (s) => primary(s) === '#824779', 'editing after Save as updates the native theme without Apply');
  assert.equal(lane(light).primary, '#824779');
  assert.deepEqual(savedPaths.map(lane), saved);
  append('web-live-edit-after-save-as-no-apply', { css: cssBrief(edited), file: lane(light), worksUnchanged: true });

  const exportReport = await exportTheme(frame);
  const exportedNames = readdirSync(downloads);
  assert.equal(exportedNames.length, 1);
  const exported = join(downloads, exportedNames[0]);
  const exportedBefore = lane(exported);
  assert.equal(exportedBefore.primary, '#824779');
  await accent(frame, '#338157');
  await waitCss(page, (s) => primary(s) === '#338157', 'distinct pre-import theme');
  await importTheme(frame, exported, 'Theme imported');
  const imported = await waitCss(page, (s) => primary(s) === '#824779', 'physical export loaded as live draft');
  assert.deepEqual(lane(exported), exportedBefore);
  append('web-export-then-import-actual-file', { export: exportReport, input: exportedNames[0], exported: exportedBefore,
    css: cssBrief(imported), originalUnchanged: true });

  const bad = join(downloads, 'v-verify-truncated.json');
  fixtureFile(bad, '{"metadata":');
  const beforeBad = { draft: await preview(frame), name: await frame.getByRole('textbox', { name: 'Rename theme' }).inputValue(),
    themeFiles: directory(dir), bad: disk(bad), exported: disk(exported), css: cssBrief(await css(page)) };
  await importTheme(frame, bad, 'Could not import this theme. Check that it’s OpenChamber theme JSON.');
  const afterBad = { draft: await preview(frame), name: await frame.getByRole('textbox', { name: 'Rename theme' }).inputValue(),
    themeFiles: directory(dir), bad: disk(bad), exported: disk(exported), css: cssBrief(await css(page)) };
  assert.deepEqual(afterBad, beforeBad);
  append('web-malformed-json-keeps-draft-and-originals', { before: beforeBad, after: afterBad });

  const unknownPath = join(downloads, 'v-verify-extra-fields.json');
  const unknown = parse(read(exported));
  delete unknown.themeStudio;
  unknown.independentReviewLabel = 'Ordinary extra metadata for verification';
  unknown.colors.syntax.highlights.fableAccent = '#476994';
  unknown.colors.primary.base = '#79537b';
  fixtureFile(unknownPath, unknown);
  const unknownBefore = disk(unknownPath);
  const unknownReport = await importTheme(frame, unknownPath, 'Theme imported');
  assert.match(unknownReport, /independentReviewLabel/u);
  assert.match(unknownReport, /fableAccent/u);
  const unknownCss = await waitCss(page, (s) => primary(s) === '#79537b', 'valid known color in file with extra harmless keys applied');
  const sanitized = parse(read(light));
  assert.equal(sanitized.independentReviewLabel, undefined);
  assert.equal(sanitized.colors.syntax.highlights.fableAccent, undefined);
  assert.deepEqual(disk(unknownPath), unknownBefore);
  assert.deepEqual(disk(collision), protectedBefore);
  append('web-unknown-harmless-keys-filtered', { input: unknownBefore, result: short(unknownReport, /Not used|independentReviewLabel|fableAccent/u),
    knownColor: cssBrief(unknownCss), filteredFromDisk: true, sourceUnchanged: true });

  const lightBeforeDark = lane(light);
  assert.equal(lane(dark), null);
  await settings(page, 'Appearance');
  assert.ok(await page.getByRole('radio', { name: 'System', exact: true }).isChecked());
  await closeSettings(page);
  const darkBase = await changeMode(page, 'dark');
  const applyDark = btn(frame, 'Apply Dark');
  await applyDark.waitFor();
  assert.equal(lane(dark), null);
  assert.deepEqual(lane(light), lightBeforeDark);
  append('web-system-dark-no-automatic-borrowing', { css: cssBrief(darkBase), darkSlot: null, lightFileUnchanged: true });
  await applyDark.click();
  const darkFile = await until(() => lane(dark), 'Dark written only after explicit button');
  const darkApplied = await waitCss(page, (s) => s.mode === 'dark' && primary(s) === darkFile.primary, 'explicit dark theme is rendered');
  assert.notEqual(primary(darkApplied), primary(darkBase));
  assert.ok(darkFile.confirmed);
  assert.deepEqual(lane(light), lightBeforeDark);
  append('web-dark-explicit-apply', { css: cssBrief(darkApplied), file: darkFile, lightFileUnchanged: true });
  const lightAgain = await changeMode(page, 'light');
  assert.equal(primary(lightAgain), lightBeforeDark.primary);
  await editorMode(frame, 'light');
  const restoredLight = await restore(page, frame, light, webStart);
  assert.deepEqual(lane(dark), darkFile);
  const darkAgain = await changeMode(page, 'dark');
  assert.equal(primary(darkAgain), darkFile.primary);
  await editorMode(frame, 'dark');
  const restoredDark = await restore(page, frame, dark, darkBase);
  assert.deepEqual(lane(light), restoredLight.file);
  append('web-both-temporary-themes-independently-restored', { light: restoredLight, dark: restoredDark, otherVariantUnchanged: true });
  await changeMode(page, 'light');
  await editorMode(frame, 'light');
  await apply(page, frame, light, webStart);
  await btn(frame, 'Use long term').click();
  const stable = await until(() => {
    const written = lane(light);
    return written?.id === 'theme-studio-live-light' && written;
  }, 'long term moves the borrowed identity into the personal slot');
  await waitCss(page, (s) => primary(s) === primary(webStart), 'old theme restored before explicitly selecting personal slot');
  const beforeInAppearance = configSnapshot(state.openchamberData);
  await nativeTheme(page, 'light', stable.name, stable.id);
  const nativeSlot = await waitCss(page, (s) => primary(s) === stable.primary, 'manually selecting the personal slot changes native theme');
  await frame.getByText('Connected · visible in OpenChamber', { exact: true }).waitFor();
  const afterInAppearance = configSnapshot(state.openchamberData);
  append('web-long-term-slot-one-native-selection', { file: stable, css: cssBrief(nativeSlot),
    beforeAppearanceSelection: themePreferences(beforeInAppearance),
    afterAppearanceSelection: themePreferences(afterInAppearance),
    preferencesDelta: configDiff(beforeInAppearance, afterInAppearance) });
  const secondSave = await save(frame, 'Independent Long Term');
  const longPath = join(dir, 'theme-studio-independent-long-term-light.json');
  const longWritten = lane(longPath);
  assert.ok(longWritten);
  await accent(frame, '#355d98');
  const longEdited = await waitCss(page, (s) => primary(s) === '#355d98', 'long term edit after Save as needs no extra Apply');
  assert.equal(lane(light).primary, '#355d98');
  assert.deepEqual(lane(longPath), longWritten);
  append('web-long-term-saving-does-not-disconnect-live', { report: secondSave, copy: longWritten, css: cssBrief(longEdited) });
  await nativeTheme(page, 'light', 'OpenChamber');
  if (peer) await nativeTheme(peer, 'light', 'OpenChamber');
  const deletions = [lane(light), lane(dark), ...saved, longWritten];
  for (const item of deletions) await nativeDelete(page, dir, item);
  await closeSettings(page);
  assert.deepEqual(directory(dir), { 'theme-studio-independent-archive-light.json': protectedBefore });
  const finalCss = await css(page);
  assert.deepEqual(finalCss.values, webStart.values);
  if (peer) assert.deepEqual((await css(peer)).values, webStart.values);
  append('web-native-appearance-cleanup', { removed: deletions.map(({ id }) => id), remaining: directory(dir),
    nativeOriginalRestored: true, secondClientIncluded: Boolean(peer) });
  await remove(page);
  const finalConfig = configSnapshot(state.openchamberData);
  append('web-final-state', { css: cssBrief(await css(page)), files: directory(dir),
    nativeConfig: configDiff(config, finalConfig), configThemeFields: { initial: themePreferences(config), final: themePreferences(finalConfig) },
    controllerRewroteNativeConfig: false });
}
const fixture = await openFixture(name);
const { page, state } = fixture;
page.setDefaultTimeout(7_000);
const served = new Map();
page.on('response', (response) => {
  const path = new URL(response.url()).pathname;
  const asset = path.match(/^\/api\/guest-files\/[^/]+\/(panel\/(?:index\.html|style\.css|main\.js|builtins\.js))$/u)?.[1];
  if (asset && response.ok()) void response.body().then((raw) => served.set(asset, sha(raw))).catch(() => {});
});
let frame;
try {
  assert.equal(manifest['panel/main.js'], SHIPPED);
  const rootHashes = hashes(repo);
  const stagedHashes = hashes(join(state.dir, 'extension'));
  assert.deepEqual(rootHashes, manifest);
  assert.deepEqual(stagedHashes, manifest);
  if (!data.package) {
    data.package = { git: execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      root: rootHashes, staged: stagedHashes };
    data.fixture = { pid: state.pid, start: state.start, mode: state.mode, defaultDataDir: state.defaultDataDir,
      url: page.url(), version: state.mode === 'desktop' ?
        execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'openchamber'], { encoding: 'utf8' }) :
        parse(readFileSync(join(repo, '.dev-host/runtime/deps/node_modules/@openchamber/web/package.json'))).version };
  }
  if (task === 'deny') await denied(page);
  else if (task === 'survey') {
    frame = await approve(page);
    append('panel-snapshot', { controls: short(await detail(frame), /button|tab |alert|status/u, 45) });
  } else if (task === 'desktop' || task === 'degradation') {
    if (await btn(page, 'Close settings').isVisible()) await closeSettings(page);
    frame = data.observations.some((o) => o.stage === 'native-approval-then-right-sidebar')
      ? await openExtension(page, title) : await approve(page);
    await (task === 'desktop' ? desktop : degradation)(page, frame, state);
  } else if (task === 'fixed-name') {
    await fixedName(page, state);
  } else if (['web', 'web-main', 'web-two', 'web-first-click', 'web-resume-before-first-apply'].includes(task)) {
    frame = task === 'web-resume-before-first-apply' ? await openExtension(page, title) : await approve(page);
    await until(() => served.get('panel/main.js'), 'record the actual guest JavaScript response SHA-256', 2500);
    // The native guest server adds its runtime bridge/style to the HTML
    // response; JS/CSS assets must still be byte identical with the package.
    for (const [path, hash] of served) if (path !== 'panel/index.html') assert.equal(hash, manifest[path]);
    append('browser-served-panel-assets', { hashes: Object.fromEntries(served), htmlIsRuntimeWrapped: served.get('panel/index.html') !== manifest['panel/index.html'] });
    await webFirst(page, frame, state, task.replace(/^web-/u, ''));
  } else assert.fail(`Unknown operation: ${task}`);
  assert.deepEqual(hashes(repo), manifest);
  assert.deepEqual(hashes(join(state.dir, 'extension')), manifest);
  append('root-and-staged-hashes-still-match', { entries: Object.keys(manifest).length, mainJS: SHIPPED });
} catch (error) {
  append('observation-stopped', { reason: error.message,
    controls: short(await (frame ? detail(frame) : page.locator('body').ariaSnapshot()).catch(() => ''), /dialog|heading|button|option|status|alert/u, 66) });
  process.exitCode = 1;
} finally {
  await fixture.close();
}
