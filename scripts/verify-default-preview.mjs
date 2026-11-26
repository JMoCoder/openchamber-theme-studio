// Black-box Restore and ownership checks. Never connects to a daily host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { btn, bytes, closeSettings, css, files, frameNode, json, selectNative,
  settings, sha, switchMode, until, waitOriginal } from './v-verify-rc2-ui.mjs';
import { changeNativeMode } from './verify-cross-mode-matrix.mjs';
import { themeKey } from '../src/host/identify.mjs';

const [name, scenario, start, upgradedPackage, legacySelection = 'builtin'] = process.argv.slice(2);
assert.match(name ?? '', /^l03-[a-z0-9-]{1,15}$/u);
assert.ok(['before', 'repeat', 'legacy', 'ownership'].includes(scenario));
assert.ok(['light', 'dark'].includes(start));
if (scenario === 'legacy') {
  assert.match(upgradedPackage ?? '', /^i1-l03-fix\d+$/u);
  assert.ok(['builtin', 'slot'].includes(legacySelection));
}
const alt = start === 'light' ? 'dark' : 'light';
const factory = json(join(repo, 'src/data/builtin-defaults.json'));
const builtin = (v) => `openchamber-${v}`;
const neutral = (v) => `theme-studio-live-${v}`;
const app = await openFixture(name), { page, state } = app;
assert.equal(state.dir, join(repo, '.dev-host/instances', name, 'box'));
assert.ok(state.defaultDataDir);
const dir = join(state.openchamberData, 'themes');
const slot = (v) => join(dir, `${neutral(v)}.json`);
const evidence = join(repo, 'docs/research/evidence/interactions');
mkdirSync(evidence, { recursive: true });
const prefix = name.replace(/^l03-/u, 'l03b-');
const installed = join(state.dir, 'extension/panel/main.js');
const report = { name, scenario, start, host: state.mode, bundle: sha(readFileSync(installed)), steps: [], screenshots: [] };
const output = (suffix, contents) => writeFileSync(join(evidence, `${prefix}${suffix}`), contents);
let frame;
const act = (action, id) => frame.locator(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
const choose = (v) => act('variant').and(frame.locator(`[data-value="${v}"]`));
const header = () => frame.locator('.connection').innerText();
const collect = (slug, v) => json(join(repo, `presets/${slug}-${v}.json`)).colors;
const sameColor = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const record = (step, payload = {}) => { report.steps.push({ step, ...payload }); console.log(`${name}: ${step}`); };
async function capture(label) {
  const img = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
  output(`-${label}.jpg`, img);
  report.screenshots.push({ path: `${prefix}-${label}.jpg`, sha: sha(img) });
}
async function mount() {
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
}
async function addWorkspace() {
  await btn(page, 'Choose project').click();
  await page.getByRole('option', { name: /^Add project/u }).click();
  const project = page.getByRole('dialog', { name: 'Add project' });
  await project.getByPlaceholder('Enter path or select from tree...').fill('/lab/home/work');
  await btn(project, /^Add "work"$/u).click();
  await project.waitFor({ state: 'hidden' });
  if (await btn(page, 'Choose project').isVisible()) {
    await btn(page, 'Choose project').click();
    await page.getByRole('option', { name: /^work(?:\s|$)/u }).click();
  }
}
async function closeAndReopen() {
  const rail = page.locator('[data-context-surface="plugin:theme-studio"]').and(btn(page, 'Theme Studio'));
  assert.equal(await rail.getAttribute('aria-pressed'), 'true');
  const disk = files(dir), before = await css(page);
  await rail.click();
  await until(async () => await rail.getAttribute('aria-pressed') === 'false' && (
    await page.locator('[data-context-zone=right]').getAttribute('data-context-panel-open') === 'false' ||
    !await frameNode(page).isVisible()), 'native panel actually closed');
  await rail.click();
  await mount();
  assert.deepEqual(files(dir), disk);
  assert.deepEqual((await css(page)).values, before.values);
}
async function sample(slug, v) {
  const expected = collect(slug, v);
  await until(async () => sameColor(await frame.locator('.sample').evaluate((e) =>
    e.style.getPropertyValue('--v-background').trim()), expected.surface.background), `${slug} ${v} mini preview moved`);
}
async function painted(slug, native, v, target, timeout = 7000) {
  const expected = collect(slug, v);
  return until(async () => {
    const doc = json(slot(native)), view = await css(page);
    return doc?.metadata.id === target && doc.metadata.variant === native &&
      view.mode === native && sameColor(doc.colors.primary.base, expected.primary.base) &&
      sameColor(view.brief.primary, expected.primary.base) && sameColor(view.brief.background, expected.surface.background) && view;
  }, `native ${native} window paints ${slug} ${v} through ${target}`, timeout);
}
async function apply(slug, native, v = native, { target = builtin(native), timeout } = {}) {
  if (await choose(v).getAttribute('aria-pressed') !== 'true') await choose(v).click();
  const other = native === 'light' ? 'dark' : 'light', passive = bytes(slot(other));
  await act('load-preset', slug).click();
  await sample(slug, v);
  const view = await painted(slug, native, v, target, timeout);
  assert.deepEqual(bytes(slot(other)), passive);
  return view;
}
async function restore(original, v) {
  await act('restore').click();
  const view = await waitOriginal(page, original);
  await until(() => json(slot(v))?.metadata.id === neutral(v), `restored slot ${v}`);
  return view;
}
async function saveTwins() {
  await act('save').click();
  const dlg = frame.locator('dialog[open]');
  await dlg.getByRole('textbox').fill('Exact native copy');
  await dlg.getByRole('combobox').selectOption('both');
  await btn(dlg, 'Save to file').click();
  await dlg.locator('.report-file').nth(1).waitFor();
  await btn(dlg, 'Done').click();
  return Object.fromEntries(['light', 'dark'].map((v) => [v, join(dir, `theme-studio-exact-native-copy-${v}.json`)]));
}

try {
  page.setDefaultTimeout(12_000);
  await page.setViewportSize({ width: 1360, height: 930 });
  const original = {};
  report.baselines = original;
  for (const v of [alt, start]) {
    await changeNativeMode(page, v);
    await selectNative(page, v, builtin(v));
    original[v] = await css(page);
    assert.equal(original[v].brief.primary.toLowerCase(), factory[v].colors.primary.base.toLowerCase());
  }
  await settings(page, 'Extensions');
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  await btn(page.getByRole('dialog', { name: 'Allow Theme Studio?' }), 'Allow and enable').click();
  await closeSettings(page);
  if (scenario === 'repeat') await addWorkspace();
  await mount();
  assert.deepEqual(files(dir), {});
  const visible = await apply('blue-etch', start);
  const returned = await restore(original[start], start);
  const firstNeutral = bytes(slot(start)), slotBefore = json(slot(start));
  assert.match(slotBefore.themeStudio.writer, /^restored-/u);
  assert.equal(await choose(start).getAttribute('aria-pressed'), 'true');
  record('first ordinary preview and Restore, verified against original 191 computed values', { visible: visible.brief, returned: returned.brief, firstNeutral });

  if (scenario === 'before') {
    await act('load-preset', 'tidemark').click();
    await sample('tidemark', start);
    await delay(5600); // Same hold as the independent V reproduction.
    assert.deepEqual((await css(page)).values, original[start].values);
    assert.deepEqual(bytes(slot(start)), firstNeutral);
    assert.equal(await header(), 'Panel preview only');
    await capture('pick-tidemark-after-restore');
    record('expected pre-fix failure: same V steps move only the sample', { status: await header(), firstNeutral });
  } else if (scenario === 'legacy') {
    assert.equal(themeKey(slotBefore), themeKey(factory[start]), 'unmodified 0.2.0 produced the old colliding restored file');
    const target = legacySelection === 'slot' ? neutral(start) : builtin(start);
    if (legacySelection === 'slot') await selectNative(page, start, target);
    execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), 'reload', '--name', name,
      '--extension', join(repo, '.dev-host/packages', upgradedPackage)]);
    report.updatedBundle = sha(readFileSync(installed));
    assert.notEqual(report.updatedBundle, report.bundle);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mount();
    assert.deepEqual(bytes(slot(start)), firstNeutral);
    assert.deepEqual((await css(page)).values, original[start].values);
    const began = Date.now();
    const revived = await apply('tidemark', start, alt, { target, timeout: 22_000 });
    record('0.2.0 restored file: first explicit pick reaches the window after a passive upgrade', {
      revived: revived.brief, nativeSelection: target, ms: Date.now() - began });
    await capture('legacy-first-pick');
    await restore(original[start], start);
    assert.equal(bytes(slot(start)).sha, firstNeutral.sha);
  } else if (scenario === 'repeat') {
    assert.notEqual(themeKey(slotBefore), themeKey(factory[start]));
    await closeAndReopen();
    await apply('tidemark', start);
    await capture('pick-tidemark-after-restore');
    await restore(original[start], start);
    assert.equal(bytes(slot(start)).sha, firstNeutral.sha);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mount();
    const before = files(dir);
    assert.deepEqual((await css(page)).values, original[start].values, 'reload kept the default window');
    assert.equal(before[`${neutral(start)}.json`].sha, firstNeutral.sha, 'reload did not replace the restored file');
    const third = await apply('kilnmark', start, alt);
    await capture('pick-after-restore-reload');
    await restore(original[start], start);
    assert.equal(bytes(slot(start)).sha, firstNeutral.sha);
    record('same V steps worked, then a third preview worked after window reload and restored again', { third: third.brief, before });

    await apply('tidemark', start);
    const pending = files(dir);
    await page.emulateMedia({ colorScheme: start });
    await settings(page, 'Appearance');
    await page.getByRole('radiogroup', { name: 'Color mode' }).getByRole('radio', { name: /^System\b/u }).click();
    await closeSettings(page);
    assert.deepEqual(files(dir), pending);
    assert.deepEqual((await switchMode(page, alt)).values, original[alt].values);
    assert.deepEqual(files(dir), pending);
    await apply('blue-etch', alt, start);
    await capture('system-mode-switched-preview');
    const altRestored = await restore(original[alt], alt);
    const afterBoth = files(dir);
    const startRestored = await switchMode(page, start);
    assert.deepEqual(startRestored.values, original[start].values);
    assert.deepEqual(afterBoth, files(dir));
    assert.equal(bytes(slot(start)).sha, firstNeutral.sha);
    await capture('system-mode-both-restored');
    record('System chosen natively; OS light/dark changes are passive, both touched slots restored together', {
      both: afterBoth, values: { [start]: startRestored.values, [alt]: altRestored.values },
    });
  } else {
    await selectNative(page, start, neutral(start));
    const placeholder = await css(page);
    assert.notDeepEqual(placeholder.values, original[start].values, 'the neutral slot is independently identifiable');
    await apply('kilnmark', start, alt, { target: neutral(start) });
    await restore(placeholder, start);
    assert.equal(bytes(slot(start)).sha, firstNeutral.sha);
    record('manually selected neutral theme remains selected and its exact bytes restore', { signature: placeholder.brief });
    await selectNative(page, start, builtin(start));
    const names = await saveTwins(), originalFiles = Object.values(names).map(bytes);
    await apply('tidemark', start);
    await restore(original[start], start);
    const actualSaved = json(names[start]).metadata.id;
    assert.equal(themeKey(json(names[start])), themeKey(factory[start]));
    await selectNative(page, start, actualSaved);
    const before = files(dir);
    await act('load-preset', 'kilnmark').click();
    await sample('kilnmark', start);
    const seen = await until(() => bytes(slot(start)).sha !== before[`${neutral(start)}.json`].sha && bytes(slot(start)), 'only one protected probe writes the workshop file');
    assert.equal(json(slot(start)).metadata.id, builtin(start));
    await until(async () => await header() === 'Window preview paused', 'ambiguity warning and paused state', 16_000);
    await choose(alt).click();
    await act('load-preset', 'blue-etch').click();
    await delay(500);
    assert.deepEqual(bytes(slot(start)), seen);
    assert.deepEqual((await css(page)).values, original[start].values);
    const iframe = frameNode(page);
    const grip = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role="separator"]');
    for (let i = 0; i < 4; i++) {
      const width = (await iframe.boundingBox()).width;
      if (Math.abs(width - 320) <= 2) break;
      const drag = await grip.boundingBox(), x = drag.x + drag.width / 2, y = drag.y + 32;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + width - 320, y, { steps: 10 }); await page.mouse.up();
      await delay(80);
    }
    const assertBannerFit = async (description) => {
      const fits = await frame.locator('.studio').evaluate((pane) => {
        const banner = pane.querySelector('.u-banner p'), width = pane.getBoundingClientRect().width;
        return { width, text: banner.textContent, fits: banner.scrollWidth <= banner.clientWidth + 1 };
      });
      assert.ok(Math.abs(fits.width - 320) <= 2 && fits.fits);
      record(description, fits);
    };
    await assertBannerFit('blocked message fits at 320px in English');
    await capture('saved-twin-probe-paused-en');
    await settings(page, 'Appearance');
    await page.getByRole('combobox', { name: 'Select language' }).click();
    await page.getByRole('option', { name: /Chinese \(Simplified\)|简体中文/u }).click();
    await page.locator('html[lang^="zh"]').waitFor({ state: 'attached' });
    await btn(page, '关闭设置').click();
    frame = await openExtension(page, 'Theme Studio');
    await frame.locator('.studio[data-locale=zh]').waitFor();
    assert.equal(await header(), '整窗预览已暂停');
    await assertBannerFit('blocked message fits at 320px in Simplified Chinese');
    await capture('saved-twin-probe-paused-zh');
    await btn(page, '设置').click();
    if (!await page.getByRole('heading', { name: '外观', exact: true }).isVisible()) await btn(page, '外观').click();
    await page.getByRole('combobox', { name: '选择语言' }).click();
    await page.getByRole('option', { name: /^(English|英语)$/u }).click();
    await page.locator('html[lang^="en"]').waitFor({ state: 'attached' });
    await closeSettings(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mount();
    await act('load-preset', 'kilnmark').click();
    await delay(500);
    assert.equal(await header(), 'Window preview paused');
    assert.deepEqual(bytes(slot(start)), seen);
    await selectNative(page, start, `flexoki-${start}`);
    await apply('kilnmark', start, alt, { target: `flexoki-${start}` });
    assert.deepEqual(Object.values(names).map(bytes), originalFiles);
    record('native stock twin previews; selecting the real saved twin allows exactly one attempt, then needs a different native palette; saved files unchanged', { originalFiles, seen });
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack;
  report.lastWindow = (await css(page).catch(() => null))?.brief;
  report.lastPanel = frame ? await header().catch(() => '') : '';
  throw error;
} finally {
  output('.json', JSON.stringify(report, null, 2) + '\n');
  await app.close();
}
