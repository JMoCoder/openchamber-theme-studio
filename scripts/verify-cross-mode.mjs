// Black-box Playwright proof. Only attach to a default-data dev-host instance.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { btn, bytes, closeSettings, css, files, frameNode, json, selectNative, settings, sha, switchMode,
  until, waitOriginal } from './v-verify-rc2-ui.mjs';
import { changeNativeMode, compareNative, crossModeMatrix, fullRoot } from './verify-cross-mode-matrix.mjs';
import { resolveProject } from '../src/core/project.mjs';

const [name, run = 'fixed', start = 'light', suite, base = 'flexoki'] = process.argv.slice(2);
assert.match(name ?? '', /^l03-[a-z0-9-]{1,15}$/u);
assert.ok(['old', 'fixed'].includes(run));
assert.ok(['light', 'dark'].includes(start));
assert.ok(!suite || ['matrix', 'compare', 'receipts', 'lifecycle'].includes(suite) && run === 'fixed');
assert.ok(['flexoki', 'openchamber'].includes(base));
const app = await openFixture(name);
const { page, state } = app;
assert.equal(state.dir, join(repo, '.dev-host/instances', name, 'box'));
assert.ok(state.defaultDataDir);
const dir = join(state.openchamberData, 'themes');
const slot = (v) => join(dir, `theme-studio-live-${v}.json`);
const evidence = join(repo, 'docs/research/evidence/interactions');
const evidenceStem = base === 'openchamber' ? name.replace(/^l03-/u, 'l03b-') : name;
mkdirSync(evidence, { recursive: true });
const report = { name, run, suite, base, host: state.mode, start, observations: [], screenshots: [],
  installed: sha(readFileSync(join(state.dir, 'extension/panel/main.js'))) };
const output = (suffix, contents) => writeFileSync(join(evidence, `${evidenceStem}${suffix}`), contents);
const record = (step, data = {}) => {
  report.observations.push({ step, ...data });
  console.log(`${name}: ${step}`);
};
const capture = async (label) => {
  const img = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
  output(`-${label}.jpg`, img);
  report.screenshots.push({ path: `${evidenceStem}-${label}.jpg`, sha: sha(img) });
};
let frame;
const act = (action, id) => frame.locator(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
const variant = (v) => frame.locator(`[data-act="variant"][data-value="${v}"]`);
const other = (v) => v === 'dark' ? 'light' : 'dark';
const status = () => frame.locator('.connection').innerText();
const sample = () => frame.locator('.sample').evaluate((el) => ['primary', 'background'].map(
  (k) => el.style.getPropertyValue(`--v-${k}`).trim().toLowerCase()));
const nativeColors = (doc) => [doc.colors.primary.base, doc.colors.surface.background].map((s) => s.toLowerCase());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const preset = (slug, v) => json(join(repo, 'presets', `${slug}-${v}.json`));
const defaults = json(join(repo, 'src/data/builtin-defaults.json'));
const whole = (s) => [s.brief.primary, s.brief.background].map((v) => v.toLowerCase());
const stepSample = (expected) => until(async () => same(await sample(), expected), `panel sample ${expected}`, 5000);
async function recordPick(label, expected, requested, previousFiles) {
  await stepSample(expected);
  let matched = null;
  if (run === 'fixed') {
    matched = await until(async () => {
      const actual = await css(page);
      const doc = json(slot(start));
      return actual.mode === start && same(whole(actual), expected) && doc?.themeStudio?.previewVariant === requested &&
        doc.metadata.variant === start && same(nativeColors(doc), expected) && actual;
    }, `whole window follows ${label} / ${expected}`);
    assert.deepEqual(bytes(slot(other(start))), previousFiles[`theme-studio-live-${other(start)}.json`] ?? null);
  } else {
    // This wait is longer than the actual observed good same-mode preview
    // below. The negative assertion also checks that neither file was written.
    await delay(2300);
    assert.deepEqual(files(dir), previousFiles);
    assert.notDeepEqual(whole(await css(page)), expected);
  }
  record(label, { expected, sample: await sample(), window: (matched ?? await css(page)).brief, status: await status(), files: files(dir) });
}

async function addComparison(jobs, label, v) {
  jobs.push({ index: jobs.length + 1, label, v, rendered: await fullRoot(page),
    expected: resolveProject(json(slot(start)).themeStudio.project, v, { compact: false }) });
}

async function verifyReceipts() {
  const read = (url) => url.pathname === '/api/config/themes';
  let pause = null, release = null, intercepted = 0;
  const pauseWatcher = () => { pause = new Promise((resolve) => { release = resolve; }); };
  const resumeWatcher = () => { const next = release; pause = release = null; next?.(); };
  const watcher = async (route) => {
    // Only hold the host renderer's palette reload. Guest file writes, the
    // watcher and the independent readback still hit the actual instance.
    if (pause && route.request().method() === 'GET') {
      intercepted++;
      await pause;
    }
    await route.fallback();
  };
  await page.route(read, watcher);
  const waiting = frame.locator('.connection[data-sync=waiting]');
  const timeout = frame.locator('.connection[data-sync=timeout]');
  const cross = other(start);
  try {
    const before = await css(page);
    let prior = files(dir);
    pauseWatcher();
    await variant(cross).click();
    await waiting.waitFor();
    await until(() => intercepted > 0, 'native renderer reload is held');
    assert.equal(json(slot(start)).themeStudio.previewVariant, cross);
    assert.deepEqual((await css(page)).values, before.values);
    await variant(start).click();
    await variant(cross).click();
    await variant(start).click();
    await act('load-preset', 'blue-etch').click();
    await stepSample(nativeColors(preset('blue-etch', start)));
    assert.deepEqual((await css(page)).values, before.values);
    resumeWatcher();
    await recordPick('receipt: tabs and final pick while waiting reach the window', nativeColors(preset('blue-etch', start)), start, prior);

    const applied = await css(page);
    pauseWatcher();
    prior = files(dir);
    const beforeReads = intercepted;
    await variant(cross).click();
    await waiting.waitFor();
    await until(() => intercepted > beforeReads, 'one new native renderer reload is held');
    await timeout.waitFor({ timeout: 18_000 });
    const stalled = bytes(slot(start));
    assert.deepEqual((await css(page)).values, applied.values);
    await capture('receipt-timeout');
    await act('retry').click();
    await timeout.waitFor();
    assert.deepEqual(bytes(slot(start)), stalled, 'rechecking the timed-out preview does not write');
    await act('load-preset', 'kilnmark').click();
    const afterNewClick = await until(() => {
      const doc = json(slot(start)), latest = bytes(slot(start));
      return latest.sha !== stalled.sha && doc.themeStudio.previewVariant === cross &&
        doc.themeStudio.project.origin.ref === 'kilnmark' && latest;
    }, 'new pick rewrites the already timed-out slot before releasing the renderer');
    assert.deepEqual((await css(page)).values, applied.values);
    record('receipt: confirmed real timeout followed by a fresh file write', { intercepted, stalled, afterNewClick });
    resumeWatcher();
    await recordPick('receipt: timed-out slot recovers to the latest opposite edition', nativeColors(preset('kilnmark', cross)), cross, prior);
  } finally {
    resumeWatcher();
    await page.unroute(read, watcher);
  }
}

async function verifyPanelLifecycle(original) {
  // The host's Close panel action requires a real directory key. Add only
  // the isolated workspace through the normal composer project picker.
  await btn(page, 'Choose project').click();
  await page.getByRole('option', { name: /^Add project/u }).click();
  const project = page.getByRole('dialog', { name: 'Add project' });
  await project.getByPlaceholder('Enter path or select from tree...').fill('/lab/home/work');
  await btn(project, /^Add "work"$/u).click();
  await project.waitFor({ state: 'hidden' });
  const picker = btn(page, 'Choose project');
  if (await picker.isVisible()) {
    await picker.click();
    await page.getByRole('option', { name: /^work(?:\s|$)/u }).click();
  }
  const rail = page.locator('[data-context-surface="plugin:theme-studio"]').and(btn(page, 'Theme Studio'));
  if (await rail.getAttribute('aria-pressed') !== 'true') await rail.click();
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
  const before = files(dir), displayed = await css(page);
  const panel = page.locator('[data-context-zone="right"]');
  await rail.click();
  await until(async () => await rail.getAttribute('aria-pressed') === 'false' &&
    (await panel.getAttribute('data-context-panel-open') === 'false' || !await frameNode(page).isVisible()), 'native sidebar closed');
  await capture('native-panel-closed');
  assert.deepEqual((await css(page)).values, displayed.values);
  assert.deepEqual(files(dir), before);
  await rail.click();
  await until(() => frameNode(page).isVisible(), 'real native panel reopened');
  frame = await openExtension(page, 'Theme Studio');
  await act('load-preset', 'kilnmark').and(frame.locator('[aria-pressed=true]')).waitFor();
  assert.equal(await variant(start).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(files(dir), before);
  await act('restore').click();
  const restored = await waitOriginal(page, original);
  assert.equal(json(slot(start)).metadata.id, `theme-studio-live-${start}`);
  await capture('native-panel-reopened-restored');
  record('native panel closes, reopens with the same editable draft and files, and restores the window in one click', {
    before, restored: restored.brief,
  });
}

try {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1360, height: 930 });
  const originals = {};
  if (suite === 'matrix') {
    await page.emulateMedia({ colorScheme: other(start) });
    await selectNative(page, other(start), `${base}-${other(start)}`);
    originals[other(start)] = await switchMode(page, other(start));
  }
  await page.emulateMedia({ colorScheme: start });
  await selectNative(page, start, `${base}-${start}`);
  const original = await until(async () => {
    const s = await css(page);
    const expected = base === 'openchamber' ? nativeColors(defaults[start])[0] : start === 'light' ? '#b54f14' : '#da702c';
    return s.mode === start && whole(s)[0] === expected && s;
  }, `native ${base} ${start}`);
  originals[start] = original;
  await settings(page, 'Extensions');
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  const approval = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  assert.match(await approval.ariaSnapshot(), /Theme Studio v0\.2\.0/u);
  await btn(approval, 'Allow and enable').click();
  await closeSettings(page);
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
  assert.deepEqual(files(dir), {});
  assert.deepEqual((await css(page)).values, original.values);
  await variant(other(start)).click();
  await variant(start).click();
  await delay(400);
  assert.deepEqual(files(dir), {});
  record('native install/approval and panel opening did not write', { window: original.brief });

  let begin = performance.now();
  const jobs = [];
  await act('load-preset', 'blue-etch').click();
  await stepSample(nativeColors(preset('blue-etch', start)));
  await until(async () => {
    const s = await css(page);
    return s.mode === start && same(whole(s), nativeColors(preset('blue-etch', start))) && s;
  }, 'same-mode Blue Etch');
  assert.ok(existsSync(slot(start)));
  record('same-mode control proves host file watcher works', { ms: Math.round(performance.now() - begin), window: (await css(page)).brief });
  if (suite === 'matrix') await addComparison(jobs, 'same-mode Blue Etch', start);
  const cross = other(start);
  await variant(cross).click();
  const expectedTheme = nativeColors(defaults[cross]);
  let prior = files(dir);
  await act('load-default').click();
  await recordPick('opposite tab → Default', expectedTheme, cross, prior);
  if (suite === 'matrix') await addComparison(jobs, 'opposite tab → Default', cross);
  prior = files(dir);
  await act('load-preset', 'kilnmark').click();
  await recordPick('opposite tab → curated Kilnmark', nativeColors(preset('kilnmark', cross)), cross, prior);
  if (suite === 'compare' || suite === 'matrix') await addComparison(jobs, 'opposite tab → curated Kilnmark', cross);
  await capture('cross');
  prior = files(dir);
  await variant(start).click();
  await recordPick('return tab → Kilnmark in the original mode', nativeColors(preset('kilnmark', start)), start, prior);
  if (suite === 'matrix') {
    await addComparison(jobs, 'return tab → Kilnmark in the original mode', start);
    await crossModeMatrix({ page, frame, state, dir, slot, start, originals, record, capture, report, jobs });
  }
  else if (suite === 'receipts') await verifyReceipts();
  else if (suite === 'lifecycle') await verifyPanelLifecycle(original);
  else if (suite === 'compare') {
    await changeNativeMode(page, cross);
    report.nativeComparisons = [await compareNative(page, dir, jobs[0])];
    await variant(cross).click();
    await capture('same-palette-native');
    assert.ok(report.nativeComparisons[0].diffs.every((item) => item.reason), JSON.stringify(report.nativeComparisons[0].diffs));
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  report.lastWindow = (await css(page).catch(() => null))?.brief;
  report.lastPanel = frame ? await frame.locator('body').ariaSnapshot({ timeout: 3000 }).catch(() => '') : '';
  report.nativeDialogs = await page.getByRole('dialog').allTextContents().catch(() => []);
  throw error;
} finally {
  output('.json', JSON.stringify(report, null, 2) + '\n');
  await app.close();
}
