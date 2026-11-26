#!/usr/bin/env node
// OpenChamber 2.8.0: native input and read-only disk/DOM observations on dev-host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openFixture } from './dev-browser.mjs';
import {
  act, addFromSettings, assetsMatch, blob, button, chooseFixtureProject, closeSettings, editions,
  eventually, evidence, expectedPaint, file, historicalSurface, language, load, mount, nativeMode,
  packageFingerprint, paintDiff, root, rootPaint, saveAs, settings, show, stateLine, variant, liveToggle,
} from './v-verify-0.3-fixture.mjs';
import en from '../src/i18n/ui.en.mjs';
import zh from '../src/i18n/ui.zh.mjs';

const name = process.argv[2];
assert.match(name ?? '', /^q040-(?:electron|web)[a-z0-9-]*$/u);
const source = join(root, '.dev-host/packages/i1-q040');
const installed = await openFixture(name);
const { state, page } = installed;
assert.ok(state.defaultDataDir && state.dir.startsWith(join(root, '.dev-host/instances', name, 'box')));
const themes = join(state.openchamberData, 'themes');
const storage = join(state.openchamberData, 'guest-storage/theme-studio.json');
const iframe = page.locator('iframe[title="Theme Studio"]');
const reportPath = join(evidence, `${name}-report.json`);
const report = { instance: name, host: state.mode, isolation: state, version: load(join(source, 'package.json')).version,
  hostVersion: state.mode === 'desktop' ? execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'openchamber'], { encoding: 'utf8' }) :
    load(join(root, '.dev-host/runtime/deps/node_modules/@openchamber/web/package.json')).version,
  package: packageFingerprint(source), mainBytes: file(join(source, 'panel/main.js')).size, steps: [], screenshots: [], errors: [] };
assert.equal(report.version, '0.4.0');
assert.match(report.hostVersion, /^2\.8\.0(?:$|[-+])/u);
assert.deepEqual(packageFingerprint(join(state.dir, 'extension')), report.package);
const ctx = { ...installed, themes, assets: [], record };
function record(step, details) {
  report.steps.push({ step, ...details });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${step === 'failed' ? 'FAIL' : 'PASS'} ${name} ${step}`);
}
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (!/\/panel\/(?:main\.js|style\.css)$/u.test(pathname)) return;
  let iframe = false;
  try { iframe = !!response.request().frame().parentFrame(); } catch {}
  ctx.assets.push({ name: basename(pathname), iframe, status: response.status(),
    body: response.body().catch((error) => error.message) });
});
const ids = {
  A: (v) => `theme-studio-q040-original-a-${v}`, B: (v) => `theme-studio-q040-untouched-b-${v}`,
  stock: (v) => `openchamber-${v}`,
};
const disk = (group, v) => join(themes, `${ids[group](v)}.json`);
const takeFiles = (group) => Object.fromEntries(editions.map((v) => [v, file(disk(group, v))]));
const readPalettes = async () => ({ root: await rootPaint(page), historical: await historicalSurface(page) });
const allEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const countMatches = (a, b) => {
  return `${Object.keys(b).filter((key) => a[key] === b[key]).length}/${Object.keys(b).length}`;
};
let original, protectedFiles, originalText;
const baseline = { A: {}, stock: {} };
function checkProtected() {
  assert.deepEqual(takeFiles('B'), protectedFiles, 'B’s bytes, mtime and size must stay unchanged');
}
async function selected(choose) {
  await settings(page, 'appearance');
  const result = {};
  for (const v of editions) {
    await page.locator(`[data-settings-item="appearance.${v}-theme"]`).click();
    const list = page.getByRole('listbox');
    if (choose) {
      const row = list.locator(`[data-theme-id="${ids[choose](v)}"]`);
      await row.click();
      await eventually(async () => (await row.getAttribute('aria-selected')) === 'true', `${choose}/${v} selected`);
    }
    result[v] = await list.locator('[data-theme-id][aria-selected=true]').getAttribute('data-theme-id');
  }
  await closeSettings(page);
  return result;
}
function assertSelected(value, group) {
  assert.deepEqual(value, { light: ids[group]('light'), dark: ids[group]('dark') });
}
async function install() {
  const first = ctx.assets.length;
  await addFromSettings(ctx, '0.4.0');
  await mount(ctx);
  await assetsMatch(ctx, source, first);
}
async function takeBaseline(group, v) {
  await nativeMode(page, v, v);
  const palette = await eventually(async () => {
    const value = await readPalettes();
    const def = group === 'A' && load(disk('A', v));
    return value.root.mode === v && (!def || paintDiff(value.root, expectedPaint(def)).length === 0) && value;
  }, `${group} uses original ${v} colors`);
  assert.equal(Object.keys(palette.historical).length, 191);
  if (group === 'stock') assert.equal(Object.keys(palette.root.values).length, 265);
  else assert.ok(Object.keys(palette.root.values).length >= 260, 'measure all variables emitted for the named file');
  baseline[group][v] = palette;
  const selection = await selected();
  assertSelected(selection, group);
  record(`${group}-${v}-baseline`, { selection, palettes: palette, A: takeFiles('A'), B: takeFiles('B') });
}
async function paint(label, v, trigger) {
  const path = disk('A', v), before = file(path), prior = await readPalettes();
  const sibling = v === 'light' ? 'dark' : 'light', siblingBefore = file(disk('A', sibling));
  const editorVariant = variant(ctx, v);
  if (await editorVariant.getAttribute('aria-pressed') !== 'true') await editorVariant.click();
  await trigger();
  const seen = await eventually(async () => {
    const stamp = file(path), theme = load(path);
    if (stamp?.sha256 === before.sha256 || !theme?.themeStudio?.origin || theme.themeStudio.previewVariant !== v) return null;
    const current = await readPalettes();
    return current.root.mode === v && !allEqual(current.root.values, prior.root.values) &&
      paintDiff(current.root, expectedPaint(theme)).length === 0 && { current, stamp, theme };
  }, label, 26_000);
  assert.equal(seen.theme.metadata.id, ids.A(v));
  assert.equal(seen.theme.metadata.variant, v);
  assert.deepEqual(seen.theme.themeStudio.origin, { writer: seen.theme.themeStudio.writer, raw: originalText[v] });
  assert.equal(blob(seen.theme.themeStudio.origin.raw), original[v].sha256);
  assert.ok(BigInt(seen.stamp.mtimeNs) > BigInt(before.mtimeNs));
  assert.deepEqual(file(disk('A', sibling)), siblingBefore);
  checkProtected();
  await eventually(async () => (await stateLine(ctx)).sync === 'applied', `${label}: host color receipt`);
  const selection = await selected();
  assertSelected(selection, 'A');
  assert.deepEqual(file(path), seen.stamp, 'reading selection does not write themes');
  record(label, { v, selection, A: takeFiles('A'), B: takeFiles('B'),
    coverage: { reference: 'preview file', matchedDirect: '28/28',
      historicalFromOriginal: countMatches(seen.current.historical, baseline.A[v].historical),
      rootFromOriginal: countMatches(seen.current.root.values, baseline.A[v].root.values) },
    palettes: seen.current });
}
async function pick(label, v, slug) {
  await show(ctx, 'theme');
  return paint(label, v, () => act(ctx, 'load-preset', slug).click());
}
async function narrowNotice(locale) {
  const grip = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role="separator"]');
  for (let i = 0; i < 5; ++i) {
    const frame = await iframe.boundingBox();
    if (Math.abs(frame.width - 320) <= 1) break;
    const { x, y, width } = await grip.boundingBox();
    await page.mouse.move(x + width / 2, y + 32);
    await page.mouse.down();
    await page.mouse.move(x + width / 2 + frame.width - 320, y + 32, { steps: 12 });
    await page.mouse.up();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const width = (await iframe.boundingBox()).width;
  assert.ok(Math.abs(width - 320) <= 1, `native width ${width}`);
  const notice = ctx.frame.locator('[data-note="saved-preview"]');
  await notice.waitFor();
  const words = locale === 'en' ? en : zh;
  assert.equal(await notice.innerText(), words.savedPreviewFirst);
  const geometry = await notice.evaluate((el) => {
    const doc = el.ownerDocument, layout = doc.documentElement, text = el.querySelector('p'),
      banner = el.getBoundingClientRect(), editor = doc.querySelector('.studio-main').getBoundingClientRect(),
      footer = doc.querySelector('.studio-foot').getBoundingClientRect();
    return { clientWidth: layout.clientWidth, scrollWidth: layout.scrollWidth, textWidth: text.clientWidth,
      textScrollWidth: text.scrollWidth, textHeight: text.clientHeight, textScrollHeight: text.scrollHeight,
      bannerTop: banner.top, bannerBottom: banner.bottom, editorTop: editor.top, footerBottom: footer.bottom,
      height: layout.clientHeight };
  });
  assert.equal(geometry.clientWidth, 320);
  assert.equal(geometry.scrollWidth, geometry.clientWidth);
  assert.equal(geometry.textWidth, geometry.textScrollWidth);
  assert.equal(geometry.textHeight, geometry.textScrollHeight);
  assert.ok(geometry.bannerTop >= 0 && geometry.bannerBottom <= geometry.editorTop && geometry.footerBottom <= geometry.height + 1);
  const path = join(evidence, `${name}-first-notice-${locale}-320.png`);
  const image = await iframe.screenshot({ path, animations: 'disabled' });
  report.screenshots.push({ path, sha256: blob(image), locale, width, geometry, text: words.savedPreviewFirst });
  await act(ctx, 'show-status-help').click();
  await ctx.frame.getByText(words.savedPreviewEffect, { exact: true }).waitFor();
  await act(ctx, 'show-status-help').click();
  record(`first-notice-${locale}`, { width, path, text: words.savedPreviewFirst, help: words.savedPreviewEffect });
}
async function restored(group, v, label) {
  const originalPalette = baseline[group][v];
  const actual = await eventually(async () => {
    const value = await readPalettes();
    return value.root.mode === v && allEqual(value.root.values, originalPalette.root.values) &&
      allEqual(value.historical, originalPalette.historical) && value;
  }, label, 26_000);
  const selection = await selected();
  assertSelected(selection, group);
  checkProtected();
  for (const [edition, restoredFile] of Object.entries(takeFiles('A'))) {
    assert.equal(restoredFile.sha256, original[edition].sha256);
    assert.ok(BigInt(restoredFile.mtimeNs) > BigInt(original[edition].mtimeNs));
  }
  record(label, { v, selection, A: takeFiles('A'), B: takeFiles('B'),
    historical: countMatches(actual.historical, originalPalette.historical),
    full: countMatches(actual.root.values, originalPalette.root.values), palettes: actual });
}
async function restorePair(label) {
  const before = takeFiles('A');
  await act(ctx, 'restore').click();
  await restored('A', 'dark', `${label}-dark`);
  for (const [v, stamp] of Object.entries(takeFiles('A'))) assert.ok(BigInt(stamp.mtimeNs) > BigInt(before[v].mtimeNs));
  await nativeMode(page, 'light', 'light');
  await restored('A', 'light', `${label}-light`);
}

try {
  page.setDefaultTimeout(14_000);
  if (state.mode === 'web') await page.setViewportSize({ width: 1530, height: 950 });
  await chooseFixtureProject(page);
  assert.deepEqual(takeFiles('A'), { light: null, dark: null }, 'use a fresh isolated data folder');
  assertSelected(await selected('stock'), 'stock');
  for (const v of editions) await takeBaseline('stock', v);
  await nativeMode(page, 'light', 'light');
  await install();
  await liveToggle(ctx, false);
  await act(ctx, 'load-preset', 'blue-etch').click();
  await saveAs(ctx, 'Q040 Original A');
  await act(ctx, 'load-preset', 'kilnmark').click();
  await saveAs(ctx, 'Q040 Untouched B');
  original = takeFiles('A');
  protectedFiles = takeFiles('B');
  originalText = Object.fromEntries(editions.map((v) => [v, readFileSync(disk('A', v), 'utf8')]));
  assertSelected(await selected('A'), 'A');
  for (const v of editions) await takeBaseline('A', v);
  await nativeMode(page, 'light', 'light');
  await liveToggle(ctx, true);
  for (const v of editions) {
    await nativeMode(page, v, v);
    await pick(`A-${v}-palette-one`, v, 'tidemark');
    if (v === 'light') {
      await narrowNotice('en');
      await language(ctx, 'zh');
      await narrowNotice('zh');
      await language(ctx, 'en');
      await show(ctx, 'style');
      await paint('A-light-style', v, () => act(ctx, 'style', 'brutalism').click());
      await show(ctx, 'tune');
      await paint('A-light-tune', v, () => ctx.frame.locator('[data-knob=hue][data-knob-group=all]').press('ArrowRight'));
      await paint('A-light-refine', v, async () => {
        await ctx.frame.locator('.sample [data-path="colors.primary.base"]').first().click();
        const hex = ctx.frame.locator('[data-picker-hex]');
        await hex.fill('#77558c'); await hex.press('Enter');
      });
    }
    await pick(`A-${v}-palette-two`, v, 'hojicha');
  }
  await restorePair('A-one-restore');
  for (const v of editions) {
    await nativeMode(page, v, v);
    await pick(`A-before-uninstall-${v}`, v, 'tidemark');
  }
  const preRemove = takeFiles('A'), storageBefore = file(storage), before = await readPalettes();
  assert.ok(storageBefore);
  await settings(page, 'extensions');
  await button(page, /Theme Studio .* · v0\.4\.0/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeSettings(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await iframe.waitFor({ state: 'detached' });
  await eventually(async () => allEqual((await rootPaint(page)).values, before.root.values), 'paint stays after native removal');
  assert.equal(file(storage), null, 'native removal erased extension storage');
  assert.deepEqual(takeFiles('A'), preRemove);
  checkProtected();
  const afterRemove = await selected();
  assertSelected(afterRemove, 'A');
  record('native-remove-keeps-disk-preview', { selection: afterRemove, storageBefore, storageAfter: null,
    A: takeFiles('A'), B: takeFiles('B'), palettes: before });
  await install();
  assert.deepEqual(takeFiles('A'), preRemove, 'opening after native reinstall makes no theme writes');
  checkProtected();
  const reinstalled = await selected();
  assertSelected(reinstalled, 'A');
  record('native-reinstall-reads-before-restore', { selection: reinstalled, A: takeFiles('A'), B: takeFiles('B'), palettes: await readPalettes() });
  await restorePair('A-one-restore-after-reinstall');
  const after = takeFiles('A');
  assertSelected(await selected('stock'), 'stock');
  for (const v of editions) {
    await nativeMode(page, v, v);
    const editing = variant(ctx, v);
    if (await editing.getAttribute('aria-pressed') !== 'true') await editing.click();
    await show(ctx, 'theme');
    await act(ctx, 'load-preset', 'tidemark').click();
    const path = join(themes, `theme-studio-live-${v}.json`);
    await eventually(async () => load(path)?.metadata.id === ids.stock(v) &&
      !allEqual((await rootPaint(page)).values, baseline.stock[v].root.values) &&
      (await stateLine(ctx)).sync === 'applied', `stock ${v} preview`, 26_000);
    assert.deepEqual(takeFiles('A'), after);
    checkProtected();
    const selection = await selected();
    assertSelected(selection, 'stock');
    record(`stock-${v}-preview`, { selection, A: takeFiles('A'), B: takeFiles('B'), slot: file(path), palettes: await readPalettes() });
  }
  await act(ctx, 'restore').click();
  await restored('stock', 'dark', 'stock-dark-restored');
  await nativeMode(page, 'light', 'light');
  await restored('stock', 'light', 'stock-light-restored');
  assert.deepEqual(takeFiles('A'), after, 'stock previews never rewrite A');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(packageFingerprint(join(state.dir, 'extension')), report.package);
  record('complete', { result: 'pass' });
} catch (error) {
  const screenshot = join(evidence, `${name}-failed.png`);
  await page.screenshot({ path: screenshot, timeout: 3000 }).catch(() => {});
  record('failed', { error: error.stack, screenshot, A: takeFiles('A'), B: takeFiles('B'), status: ctx.frame && await stateLine(ctx).catch(() => null) });
  throw error;
} finally {
  await installed.close();
}
