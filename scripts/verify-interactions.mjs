// 0.2 black-box acceptance against an isolated, freshly started 2.8.0 host.
// Install and delete through the native settings. Do not import the editor.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { btn, bytes, closeSettings, css, files, frameNode, json, selectNative, settings, sha, switchMode,
  until, waitColor, waitOriginal } from './v-verify-rc2-ui.mjs';

const args = process.argv.slice(2), slowRead = args.includes('--slow-read');
const [name, privateBuild, ...extra] = args.filter(arg => arg !== '--slow-read');
assert.match(name ?? '', /^ts2-(?:web|desk)-[a-z0-9-]{1,14}$/u);
assert.equal(extra.length, 0);
if (privateBuild) assert.match(privateBuild, /^i1-[a-z0-9-]{1,36}$/u);
const app = await openFixture(name);
const { page, state } = app;
assert.ok(state.running && state.defaultDataDir && state.dir === join(repo, '.dev-host/instances', name, 'box'));
assert.notEqual(new URL(state.url).port, '57123');
const dir = join(state.openchamberData, 'themes'), slot = v => join(dir, `theme-studio-live-${v}.json`);
const evidence = privateBuild ? join(state.dir, 'evidence') : join(repo, 'docs/research/evidence/interactions');
mkdirSync(evidence, { recursive: true });
const assets = ['package.json', 'panel/index.html', 'panel/main.js', 'panel/builtins.js', 'panel/style.css', 'LICENSE', 'NOTICE.md'];
const sums = root => Object.fromEntries(assets.map(p => [p, sha(readFileSync(join(root, p)))]));
const source = privateBuild ? join(repo, '.dev-host/packages', privateBuild) : repo;
const root = sums(source), installed = sums(join(state.dir, 'extension')), rendered = {};
assert.deepEqual(root, installed);
const version = json(join(repo, 'package.json')).version;
assert.equal(version, '0.2.0');
const report = { name, host: state.mode, version, privateBuild, root, installed, observations: [], screenshots: [], errors: [] };
const record = (stage, data = {}) => {
  report.observations.push({ stage, ...data });
  console.log(`${name}: ${stage}`);
};
const output = (suffix, data) => writeFileSync(join(evidence, `${name}${suffix}`), data);
const capture = async caption => {
  const image = await page.screenshot({ type: 'jpeg', quality: 81, animations: 'disabled' });
  const path = `${name}-${caption}.jpg`;
  output(`-${caption}.jpg`, image);
  report.screenshots.push({ path, sha: sha(image) });
};
let holdReads = slowRead, delayedReplies = 0, themeWrites = 0;
page.setDefaultTimeout(14_000);
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', resp => {
  const file = new URL(resp.url()).pathname.match(/\/api\/guest-files\/[^/]+\/(panel\/(?:index\.html|main\.js|builtins\.js|style\.css))$/u)?.[1];
  if (file && resp.ok()) resp.body().then(buf => { rendered[file] = sha(buf); }).catch(() => {});
});
let frame;
const act = (action, id) => frame.locator(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
const tab = key => act('tab', key).click();
const form = () => frame.locator('dialog[open]');
const index = json(join(repo, 'presets/index.json'));
const stock = json(join(repo, 'src/data/builtin-defaults.json'));
const preset = (slug, v = 'light') => json(join(repo, 'presets', `${slug}-${v}.json`));
const colors = d => [d.colors.primary.base, d.colors.surface.background].map(c => c.toLowerCase());
const sampleColors = () => frame.locator('.sample').evaluate(el =>
  ['primary', 'background'].map(k => el.style.getPropertyValue(`--v-${k}`).trim().toLowerCase()));
async function seen(v, expected, recipe) {
  const settled = await until(async () => {
    const f = json(slot(v)), host = await css(page);
    if (!f || f.metadata.variant !== v || f.themeStudio?.project.style[v].id !== recipe ||
      String(host.mode) !== v || [host.brief.primary, host.brief.background].map(c => c.toLowerCase()).join() !== expected.join() ||
      colors(f).join() !== expected.join()) return null;
    const sample = await sampleColors();
    if (sample.join() !== expected.join()) return null;
    return { mode: host.mode, host: host.brief, sample, slotId: f.metadata.id, recipe, rev: f.themeStudio.rev };
  }, `file, iframe and window agree: ${v} / ${expected} / ${recipe}`);
  return settled;
}
async function editMode(mode) {
  await frame.locator(`[data-act="variant"][data-value="${mode}"]`).click();
}
async function reopen() {
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
}
async function localeZh() {
  await settings(page, 'Appearance');
  await page.getByRole('combobox', { name: 'Select language' }).click();
  const choice = page.getByRole('option', { name: /Chinese \(Simplified\)|简体中文/u });
  await choice.click();
  await page.locator('html[lang^="zh"]').waitFor({ state: 'attached' });
  await btn(page, /关闭设置/u).click();
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('[data-locale="zh"]').waitFor();
}
async function deleteOne(id, variant) {
  await settings(page, 'Appearance');
  const mode = variant === 'light' ? 'Light' : 'Dark';
  await btn(page.getByRole('group', { name: 'Themes', exact: true }), mode).click();
  const row = page.getByRole('listbox', { name: `${mode} theme`, exact: true }).locator(`[data-theme-id="${id}"]`);
  await row.waitFor();
  await btn(row, /delete|remove/iu).click();
  const confirm = btn(page, /^(Delete|Remove)$/u).filter({ visible: true });
  if (await confirm.waitFor({ timeout: 850 }).then(() => true, () => false)) await confirm.click();
  await until(() => !existsSync(join(dir, `${id}.json`)), `native deleted ${id}`);
  await closeSettings(page);
}
try {
  assert.deepEqual(readdirSync(dir), [], 'requires a clean private theme directory');
  if (slowRead) {
    assert.equal(state.mode, 'web');
    // Only this fixture: defer two successful, read-only responses beyond the
    // SDK deadline. All writes and their bodies go straight to the real host.
    await page.route(`${state.url}/api/guests/theme-studio/files`, async route => {
      const op = route.request().postDataJSON();
      if (op?.op === 'write') themeWrites++;
      if (holdReads && op?.op === 'stat' && op.path?.endsWith('/themes')) {
        const response = await route.fetch();
        assert.ok(response.ok());
        delayedReplies++;
        await delay(8500);
        await route.fulfill({ response });
      } else await route.fallback();
    });
  }
  await page.setViewportSize({ width: 1360, height: 930 });
  await page.emulateMedia({ colorScheme: 'light' });
  // A non-default starting theme establishes the difference between Default and Restore.
  await selectNative(page, 'light', 'flexoki-light');
  const light = await waitColor(page, '#b54f14', 'light');
  const dark = await switchMode(page, 'dark');
  await switchMode(page, 'light');
  await waitOriginal(page, light);
  await settings(page, 'Extensions');
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  const approval = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  assert.ok((await approval.ariaSnapshot()).includes(`v${version}`));
  await btn(approval, 'Allow and enable').click();
  await closeSettings(page);
  frame = await openExtension(page, 'Theme Studio');
  if (slowRead) await act('recheck-files').waitFor({ timeout: 35_000 });
  else await frame.locator('footer [data-act=save]:enabled').waitFor();
  assert.equal(await frameNode(page).getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await act('apply').count(), 0);
  assert.equal(await frame.locator('.preset-cards button').first().getAttribute('data-act'), 'load-default');
  assert.equal(await frame.locator('.preset-cards button').count(), index.presets.length + 1);
  assert.deepEqual(readdirSync(dir), []);
  record('native-folder-install-and-permission; opening is read-only', { initial: light.brief, darkBase: dark.brief });
  if (slowRead) {
    const blue = colors(preset('blue-etch'));
    assert.ok(delayedReplies >= 2);
    assert.equal(await act('save').isDisabled(), true);
    await act('load-preset', 'blue-etch').click();
    await until(async () => (await sampleColors()).join() === blue.join(), 'degraded editor remains editable');
    holdReads = false;
    await act('recheck-files').click();
    await frame.locator('footer [data-act=save]:enabled').waitFor();
    assert.deepEqual(await sampleColors(), blue);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(themeWrites, 0);
    assert.deepEqual((await css(page)).values, light.values);
    record('delayed-reads-and-recheck-kept-draft-and-left-window-and-files-unchanged', { delayedReplies, themeWrites, sample: blue });
    await act('load-preset', 'blue-etch').click();
    record('one-new-click-after-recheck-previews-the-same-draft', await seen('light', blue, null));
    assert.equal(themeWrites, 1);
    await act('restore').click();
    const feedback = frame.locator('.studio-toast[data-tone=success]');
    await feedback.waitFor();
    const message = await feedback.innerText();
    const restored = await waitOriginal(page, light);
    assert.equal(existsSync(slot('dark')), false);
    record('slow-read-recovery-restored-original-window', { themeWrites, message, restored: restored.brief, untouchedDark: true });
  } else {
  await act('load-preset', 'blue-etch').click();
  const blue = colors(preset('blue-etch'));
  record('click-without-apply-previews-blue-in-window', await seen('light', blue, null));
  await tab('style');
  await act('style', 'brutalism').click();
  const painted = await until(async () => { const c = await sampleColors(); return c.join() !== blue.join() && c; }, 'recipe repainted');
  record('recipe-layers-on-selected-base', await seen('light', painted, 'brutalism'));
  await capture('style');
  await act('style', '').click();
  record('no-style-restores-selected-base', await seen('light', blue, null));
  await act('style', 'brutalism').click();
  await tab('theme');
  await act('load-preset', 'kilnmark').click();
  const kiln = colors(preset('kilnmark'));
  record('another-theme-wins-over-previous-recipe', await seen('light', kiln, null));
  await tab('style');
  assert.equal(await act('style', '').getAttribute('aria-pressed'), 'true');
  await tab('theme');
  await act('load-default').click();
  record('factory-default-is-distinct-from-starting-flexoki', await seen('light', colors(stock.light), null));

  await act('load-preset', 'blue-etch').click();
  await seen('light', blue, null);
  const beforeSave = bytes(slot('light'));
  await act('save').click();
  await form().getByRole('textbox').fill('Proof pair');
  await form().getByRole('combobox').selectOption('both');
  await btn(form(), 'Save to file').click();
  await form().locator('.report-file').nth(1).waitFor();
  await btn(form(), 'Done').click();
  const stem = 'theme-studio-proof-pair', paths = ['light','dark'].map(v => join(dir, `${stem}-${v}.json`));
  const copies = paths.map(bytes);
  assert.ok(copies.every(Boolean));
  assert.deepEqual(bytes(slot('light')), beforeSave);
  record('named-files-save-both-without-changing-preview', { files: copies });
  await editMode('dark');
  await act('load-preset', 'kilnmark').click();
  const darkKiln = colors(preset('kilnmark','dark'));
  await seen('light', darkKiln, null);
  assert.equal(json(slot('light')).themeStudio.previewVariant, 'dark');
  const crossBytes = bytes(slot('light'));
  const darkStart = await switchMode(page, 'dark');
  assert.deepEqual(darkStart.values, dark.values);
  assert.equal(existsSync(slot('dark')), false);
  assert.deepEqual(bytes(slot('light')), crossBytes);
  record('opposite-edition-preview-did-not-replay-on-native-mode-switch', { sample: darkKiln, host: darkStart.brief });
  await act('load-preset', 'kilnmark').click();
  record('explicit-dark-edit-starts-a-separate-preview', await seen('dark', darkKiln, null));
  await reopen();
  await act('restore').click();
  const restoredDark = await waitOriginal(page, dark);
  await until(() => !['light','dark'].some(v => json(slot(v))?.metadata?.id === (v === 'light' ? 'flexoki-light' : 'openchamber-dark')), 'retired both borrowed IDs');
  await switchMode(page, 'light');
  const restoredLight = await waitOriginal(page, light);
  assert.deepEqual(paths.map(bytes), copies);
  record('one-restore-after-reopen-restored-both-original-window-palettes-and-kept-named-files', { light: restoredLight.brief, dark: restoredDark.brief, namedFiles: paths.map(bytes) });

  await tab('theme');
  await act('manage-saved', stem).click();
  await btn(form(), 'Verify file deletion').click();
  await form().getByRole('status').filter({ hasText: /files are still there/u }).waitFor();
  await btn(form(), 'Remove from My themes only').click();
  await act('manage-saved', stem).waitFor({ state: 'detached' });
  assert.deepEqual(paths.map(bytes), copies);
  await reopen();
  await frame.locator('.saved-removed summary').click();
  await act('undo-remove-saved', stem).click();
  await act('manage-saved', stem).waitFor();
  assert.deepEqual(paths.map(bytes), copies);
  record('remove-from-list-survives-remount-and-undo-preserves-both-files');
  // Keep the panel dialog open while native settings remove files. Native
  // settings may remount the iframe; in that case reopen the surviving card.
  await act('manage-saved', stem).click();
  await deleteOne(`${stem}-light`, 'light');
  frame = await openExtension(page, 'Theme Studio');
  if (!await form().isVisible()) await act('manage-saved', stem).click();
  await btn(form(), 'Verify file deletion').click();
  const feedback = form().getByRole('status').filter({ hasText: /files are gone|files are still there/u }).first();
  await feedback.waitFor();
  const partial = await feedback.innerText();
  assert.deepEqual(bytes(paths[1]), copies[1]);
  assert.equal(existsSync(paths[0]), false);
  await deleteOne(`${stem}-dark`, 'dark');
  frame = await openExtension(page, 'Theme Studio');
  if (!await form().isVisible() && await act('manage-saved', stem).isVisible()) await act('manage-saved', stem).click();
  if (await form().isVisible()) {
    await btn(form(), 'Verify file deletion').click();
    await form().getByRole('status').filter({ hasText: /all listed files are gone/iu }).waitFor();
    await btn(form(), 'Done').click();
  }
  await act('manage-saved', stem).waitFor({ state: 'detached' });
  assert.ok(paths.every(p => !existsSync(p)));
  record('real-native-appearance-deletion-separate-from-list-removal', { partial, fileCountRemaining: 0 });

  const last = files(dir);
  await localeZh();
  assert.equal(await act('load-default').locator('.theme-card-name').innerText(), '默认');
  for (const id of ['theme','style','tune','refine','matching']) {
    await tab(id);
    assert.ok(/[\u3400-\u9fff]/u.test(await act('tab', id).innerText()));
  }
  const cnActions = (await frame.locator('footer').innerText()).trim();
  assert.match(cnActions, /保存/u); assert.match(cnActions, /还原/u);
  await tab('theme');
  await capture('zh');
  assert.deepEqual(files(dir), last);
  record('native-language-switch-to-Chinese-all-tabs-and-footer-with-no-theme-writes', { footer: cnActions });
  }
  assert.deepEqual(report.errors, []);
  for (const key of ['panel/main.js','panel/style.css']) assert.equal(rendered[key], installed[key]);
  assert.deepEqual(sums(join(state.dir, 'extension')), sums(source));
  Object.assign(report, { ok: true, rendered });
} catch (e) {
  report.ok = false; report.failure = e.stack;
  if (frame) report.lastPanel = await frame.locator('body').ariaSnapshot({ timeout: 3500 }).catch(() => '');
  throw e;
} finally {
  output('.json', JSON.stringify(report, null, 2) + '\n');
  await app.close();
}
