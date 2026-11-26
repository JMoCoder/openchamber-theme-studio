import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { btn, closeSettings, css, files, json, selectNative, settings, sha, switchMode,
  until, waitOriginal } from './v-verify-rc2-ui.mjs';

const [name, nextName] = process.argv.slice(2);
assert.match(name ?? '', /^l03-[a-z0-9-]{1,15}$/u);
assert.match(nextName ?? '', /^i1-l03-[a-z0-9-]+$/u);
const next = join(repo, '.dev-host/packages', nextName);
assert.equal(realpathSync(next), next);
const app = await openFixture(name);
const { state, page } = app;
const report = { host: state.mode, name, images: [], events: [] };
const output = (file, body) => writeFileSync(join(repo, 'docs/research/evidence/interactions', `${name}${file}`), body);
const dir = join(state.openchamberData, 'themes'), slot = (v) => join(dir, `theme-studio-live-${v}.json`);
let frame;
const act = (action, rest = '') => frame.locator(`[data-act="${action}"]${rest}`);
const variant = (v) => act('variant', `[data-value="${v}"]`);
const open = async () => {
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
};
const record = (step, payload = {}) => {
  report.events.push({ step, ...payload }); console.log(`${name}: ${step}`);
};
const paint = (mode, slug, previewVariant) => until(async () => {
  const { colors } = json(join(repo, 'presets', `${slug}-${previewVariant ?? mode}.json`));
  const doc = json(slot(mode)), actual = await css(page);
  if (doc?.metadata?.variant !== mode || doc.themeStudio.previewVariant !== previewVariant ||
      actual.mode !== mode || actual.brief.primary.toLowerCase() !== colors.primary.base.toLowerCase() ||
      actual.brief.background.toLowerCase() !== colors.surface.background.toLowerCase()) return null;
  return actual;
}, `${mode} visible ${previewVariant ?? 'legacy'} ${slug}`);
const capture = async (label) => {
  const shot = await page.screenshot({ type: 'jpeg', quality: 85, animations: 'disabled' });
  output(`-${label}.jpg`, shot);
  report.images.push({ file: `${name}-${label}.jpg`, sha: sha(shot) });
};

try {
  assert.ok(state.defaultDataDir);
  assert.equal(state.dir, join(repo, '.dev-host/instances', name, 'box'));
  assert.deepEqual(files(dir), {});
  await page.setViewportSize({ width: 1360, height: 930 });
  const original = {};
  for (const mode of ['dark', 'light']) {
    await switchMode(page, mode);
    await selectNative(page, mode, `flexoki-${mode}`);
    original[mode] = await css(page);
  }
  await settings(page, 'Extensions');
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  const approval = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  assert.match(await approval.ariaSnapshot(), /Theme Studio v0\.2\.0/u);
  await btn(approval, 'Allow and enable').click();
  await closeSettings(page);
  await open();
  const staged = join(state.dir, 'extension/panel/main.js');
  const oldJs = sha(readFileSync(staged));
  await act('load-preset', '[data-id="blue-etch"]').click();
  const oldPaint = await paint('light', 'blue-etch');
  const legacy = json(slot('light'));
  assert.match(legacy.themeStudio.writer, /^preview-/u);
  assert.deepEqual(Object.keys(legacy.themeStudio).sort(), ['project', 'rev', 'schemaVersion', 'writer']);
  const before = files(dir);
  record('0.2.0 original bundle writes a real preview without new metadata', { oldJs, file: before[basename(slot('light'))], window: oldPaint.brief });
  await capture('old-paused');

  // Use the tested instance manager, preserving its own data directory & grants.
  execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), 'reload', '--name', name, '--extension', next]);
  const newJs = sha(readFileSync(staged));
  assert.notEqual(newJs, oldJs);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await open();
  assert.deepEqual(files(dir), before);
  assert.deepEqual((await waitOriginal(page, oldPaint)).values, oldPaint.values);
  await variant('dark').click();
  const darkPaint = await paint('light', 'blue-etch', 'dark');
  assert.equal(json(slot('light')).themeStudio.writer, legacy.themeStudio.writer, 'keep the original restoration journal');
  assert.equal(json(slot('dark')), null);
  record('upgraded in-place; remount is passive and a tab click continues the legacy preview', { newJs, window: darkPaint.brief });
  await capture('continued');

  const passive = files(dir);
  await switchMode(page, 'dark');
  await waitOriginal(page, original.dark);
  assert.deepEqual(files(dir), passive);
  await variant('light').click();
  await paint('dark', 'blue-etch', 'light');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await open();
  await act('restore').click();
  const restoredDark = await waitOriginal(page, original.dark);
  await switchMode(page, 'light');
  const restoredLight = await waitOriginal(page, original.light);
  assert.equal(await variant('light').getAttribute('aria-pressed'), 'true');
  for (const v of ['light', 'dark']) assert.equal(json(slot(v)).metadata.id, `theme-studio-live-${v}`);
  record('one restore after restart restored both 191-variable whole-window snapshots and the original editor tab', {
    restoredLight: restoredLight.brief, restoredDark: restoredDark.brief, files: files(dir),
  });
  await capture('restored');
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  report.lastWindow = (await css(page).catch(() => null))?.brief;
  report.lastPanel = frame ? (await frame.locator('.studio-header').ariaSnapshot({ timeout: 2800 }).catch(() => '')) : '';
  throw error;
} finally {
  output('.json', JSON.stringify(report, null, 2) + '\n');
  await app.close();
}
