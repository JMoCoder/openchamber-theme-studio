// Run against a fresh, manual-install dev-host fixture (see interactions.md).
// Native Settings performs every install, approval, removal and appearance
// change. The only setup write is copying the released ZIP into the lab.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openFixture } from './dev-browser.mjs';
import {
  act, addFromSettings, assetsMatch, blob, button, curated, editions, eventually, evidence,
  expectPaint, file, historicalSurface, identical, language, liveToggle, load, mount, nativeMode, nativeTheme,
  paintSummary, root, rootPaint, sample, saveAs, settings, show, slotFile, snapFiles, stateLine, variant,
} from './v-verify-0.3-fixture.mjs';

const [name, flag, fixtureName = 'i1-r031', ...extra] = process.argv.slice(2);
assert.match(name ?? '', /^r031w?-[a-z0-9-]{1,13}$/u);
assert.ok(!extra.length && (flag === '--fixture' || flag === undefined && fixtureName === 'i1-r031'),
  'usage: node scripts/verify-reinstall-031.mjs <instance> [--fixture i1-r031w]');
assert.ok(['i1-r031', 'i1-r031w'].includes(fixtureName));
const wide = fixtureName === 'i1-r031w';
assert.equal(name.startsWith('r031w-'), wide, 'evidence prefixes must identify their candidate');
const fixture = join(root, '.dev-host/packages', fixtureName);
assert.equal(realpathSync(fixture), fixture);
const packageFiles = ['package.json', 'panel/index.html', 'panel/main.js', 'panel/builtins.js', 'panel/style.css', 'LICENSE', 'NOTICE.md'];
const frozen = new Map(packageFiles.map(path => [path, readFileSync(join(fixture, path))]));
const fixtureFiles = Object.fromEntries([...frozen].map(([path, bytes]) => [path, { bytes: bytes.length, sha256: blob(bytes) }]));
const zip = join(root, 'artifacts/theme-studio-0.3.0.zip');
const oldBundle = execFileSync('unzip', ['-p', zip, 'theme-studio/panel/main.js']);
const bundle = frozen.get('panel/main.js');
assert.ok(bundle.length <= 600_000 && !bundle.equals(oldBundle));
assert.equal(load(join(fixture, 'package.json')).version, '0.3.1');
const app = await openFixture(name);
const { page, state } = app;
const dir = join(root, '.dev-host/instances', name, 'box');
const source = join(dir, 'extension');
assert.equal(state.dir, dir);
assert.equal(state.openchamberData, join(dir, 'home/.config/openchamber'));
assert.ok(state.defaultDataDir && !state.networkTest);
assert.equal(realpathSync(source), source);
for (const [path, bytes] of frozen) {
  assert.ok(readFileSync(join(source, path)).equals(bytes), `staged candidate matches the frozen ${path}`);
}
const themes = join(state.openchamberData, 'themes');
const storagePath = join(state.openchamberData, 'guest-storage/theme-studio.json');
const ctx = { ...app, themes, assets: [], record };
const report = {
  host: state.mode, nativeHostVersion: state.mode === 'desktop'
    ? execFileSync('dpkg-query', ['-W', '-f=${Version}', 'openchamber'], { encoding: 'utf8' }).trim()
    : load(join(root, '.dev-host/runtime/deps/node_modules/@openchamber/web/package.json')).version,
  fixture, instance: name, isolated: { pid: state.pid, endpoint: state.url, data: state.openchamberData },
  bundle: fixtureFiles['panel/main.js'], fixtureFiles,
  releaseZip: { sha256: file(zip).sha256, bundleBytes: oldBundle.length, bundleSha256: blob(oldBundle) },
  steps: [], screenshots: [],
};
const json = join(evidence, `${name}-reinstall.json`);
function record(stage, data) {
  report.steps.push({ stage, ...data });
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
}
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (!/\/panel\/(?:main\.js|style\.css)$/u.test(pathname)) return;
  let iframe = false;
  try { iframe = !!response.request().frame().parentFrame(); } catch {}
  ctx.assets.push({ name: basename(pathname), iframe, status: response.status(),
    body: response.body().catch((error) => error.message) });
});
const iframe = page.locator('iframe[title="Theme Studio"]');
const named = () => Object.fromEntries(Object.entries(snapFiles(ctx)).filter(([n]) => !/^theme-studio-live-/u.test(n)));
const builtinId = (v) => `openchamber-${v}`;
const ownId = (v) => `theme-studio-live-${v}`;
const slots = () => Object.fromEntries(editions.map(v => [v, file(slotFile(ctx, v))]));
const envelope = (v) => load(slotFile(ctx, v)).themeStudio;
function journal(v) {
  const storage = load(storagePath) ?? {};
  const prefix = `studio:v1:preview-original-${v}`;
  const head = storage[prefix];
  return head?.pages ? JSON.parse(Array.from({ length: head.pages },
    (_, i) => storage[`${prefix}:${head.generation}:${i}`]).join('')) : head?.value ?? null;
}
const matching = (a, b) => {
  assert.deepEqual(a, b);
  return `${Object.keys(a).length}/${Object.keys(b).length}`;
};
const stock = {};
async function nativePalette(v, label) {
  const result = await eventually(async () => {
    const rootStyles = await rootPaint(page), historical = await historicalSurface(page);
    return rootStyles.mode === v && identical(rootStyles.values, stock[v].root.values) &&
      identical(historical, stock[v].historical) && { rootStyles, historical };
  }, label, 22_000);
  return {
    historical: matching(result.historical, stock[v].historical),
    full: matching(result.rootStyles.values, stock[v].root.values),
    paint: paintSummary(result.rootStyles),
  };
}
async function closeInstaller() {
  // Activate the real close control with the keyboard. Some Electron
  // fixture reloads drop pointer events near the native titlebar.
  const close = button(page, 'Close settings');
  for (let i = 0; i < 3 && await close.isVisible(); ++i) {
    await close.press('Enter');
    if (await close.waitFor({ state: 'hidden', timeout: 1_500 }).then(() => true, () => false)) return;
  }
  await close.waitFor({ state: 'hidden' });
}
async function install(version) {
  const start = ctx.assets.length;
  let prompt;
  if (version === '0.3.1') prompt = await addFromSettings(ctx, version, false);
  else {
    await settings(page, 'extensions');
    await page.getByText('No extensions loaded.', { exact: true }).waitFor();
    await button(page, /^Add extension Folder/u).click();
    await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/theme-studio-0.3.0.zip');
    await button(page, 'Add extension from a folder, ZIP, or URL').click();
    prompt = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
    await prompt.waitFor({ timeout: 36_000 });
    assert.match(await prompt.ariaSnapshot(), /Theme Studio v0\.3\.0 wants to/u);
  }
  await button(prompt, 'Allow and enable').click();
  await prompt.waitFor({ state: 'hidden' });
  await closeInstaller();
  await mount(ctx);
  if (version === '0.3.1') {
    const registration = await eventually(() => {
      const value = load(join(state.openchamberData, 'extensions.json'));
      return value?.paths?.includes('/lab/extension') && value.capabilityGrants?.['theme-studio'];
    }, 'native registration and grant persisted');
    record('native-add-and-approval', { version, source: '/lab/extension', grants: registration });
    await assetsMatch(ctx, fixture, start);
  }
  else {
    const response = await eventually(() => ctx.assets.slice(start).find(a => a.iframe && a.name === 'main.js'), '0.3.0 iframe asset');
    const bytes = await response.body;
    assert.ok(Buffer.isBuffer(bytes) && bytes.equals(oldBundle), '0.3.0 actually executed the released ZIP bytes');
    record('native-zip-install', { version, path: '/lab/theme-studio-0.3.0.zip', sha256: blob(bytes) });
  }
}
async function remove(version, v) {
  const before = snapFiles(ctx), paint = await rootPaint(page), persistence = file(storagePath);
  assert.ok(persistence && journal(v));
  await settings(page, 'extensions');
  await button(page, new RegExp(`Theme Studio .* · v${version.replaceAll('.', '\\.')}`, 'u')).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeInstaller();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await closeInstaller();
  await iframe.waitFor({ state: 'detached' });
  await eventually(async () => identical((await rootPaint(page)).values, paint.values), 'uninstall does not repaint');
  assert.equal(file(storagePath), null, 'native remove cleared the entire guest storage');
  assert.deepEqual(snapFiles(ctx), before, 'native remove did not remove or rewrite themes');
  record('native-remove', { version, v, storageBefore: persistence, storageAfter: null, paint: paintSummary(paint), slots: slots() });
}
async function pick(v, slug, old = false) {
  await show(ctx, 'theme');
  if (await variant(ctx, v).getAttribute('aria-pressed') !== 'true') await variant(ctx, v).click();
  await expectPaint(ctx, { label: `${old ? 'released ZIP' : '0.3.1'}: ${slug} / ${v}`,
    mode: v, edit: v, def: curated(slug, v), trigger: () => act(ctx, 'load-preset', slug).click(), timeout: 22_000 });
  await eventually(async () => (await stateLine(ctx)).sync === 'applied', `preview receipt ${slug} / ${v}`);
  const raw = load(slotFile(ctx, v));
  assert.match(raw.themeStudio.writer, /^preview-/u);
  assert.equal(Object.hasOwn(raw.themeStudio, 'origin'), !old);
  return raw;
}
async function width(px) {
  const grip = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role=separator]');
  for (let i = 0; i < 4; ++i) {
    const frame = await iframe.boundingBox();
    if (Math.abs(frame.width - px) <= 1) return frame.width;
    const { x, y, width } = await grip.boundingBox();
    await page.mouse.move(x + width / 2, y + 32);
    await page.mouse.down();
    await page.mouse.move(x + width / 2 + frame.width - px, y + 32, { steps: 12 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const actual = (await iframe.boundingBox()).width;
  assert.ok(Math.abs(actual - px) <= 1, `real splitter: requested ${px}, measured ${actual}`);
  return actual;
}
async function pictures(scene) {
  const before = snapFiles(ctx);
  const isDesktop = state.mode === 'desktop';
  for (const lang of isDesktop ? ['zh', 'en'] : ['en']) {
    if (await ctx.frame.locator('.studio').getAttribute('data-locale') !== lang) await language(ctx, lang);
    const message = (await stateLine(ctx)).text;
    const recovery = act(ctx, 'recover-builtin');
    const guide = act(ctx, 'recovery-guide');
    if (scene === 'legacy-builtin') {
      assert.equal(message, lang === 'zh' ? '旧预览待恢复' : 'Old preview to clear');
      assert.equal((await recovery.innerText()).trim(), lang === 'zh' ? '恢复内置配色' : 'Restore built-in colors');
    } else {
      assert.equal(await recovery.count(), 0);
      if (scene === 'legacy-preserve') assert.equal(message, lang === 'zh' ? '无法找回原配色' : 'Original colors unavailable');
      else {
        assert.doesNotMatch(message, /预览备份|旧预览|无法找回|preview backup|old preview|unavailable/iu);
        assert.equal(await guide.count(), 0);
      }
    }
    for (const px of isDesktop ? [320, 724] : [420]) {
      const actual = await width(px);
      const layout = await ctx.frame.locator('body').evaluate(el => {
        const view = el.ownerDocument.documentElement;
        const nodes = [...el.querySelectorAll('.connection,.connection span,.banner-actions button,.u-banner p,.footer-actions button')]
          .filter(node => node.getClientRects().length);
        return { width: view.clientWidth, height: view.clientHeight, documentWidth: view.scrollWidth,
          clipped: nodes.filter(node => node.scrollWidth > node.clientWidth + 1 ||
            node.getBoundingClientRect().right > view.clientWidth + 1 ||
            node.getBoundingClientRect().bottom > view.clientHeight + 1).map(node => node.textContent) };
      });
      assert.equal(layout.width, Math.round(actual));
      assert.equal(layout.documentWidth, layout.width);
      assert.deepEqual(layout.clipped, []);
      const path = join(evidence, `${name}-${scene}-${lang}-${px}.png`);
      const bytes = await iframe.screenshot({ path, animations: 'disabled' });
      report.screenshots.push({ scene, lang, path: basename(path), actual, layout, message, sha256: blob(bytes) });
    }
  }
  assert.deepEqual(snapFiles(ctx), before, 'changing language and width did not repaint');
  record('panel-screenshots', { scene });
}
async function clearFromFooter(label) {
  const from = await ctx.frame.locator('body').evaluate(() => window.__v03RecordedClicks.length);
  await act(ctx, 'restore').click();
  const palette = { dark: await nativePalette('dark', `${label}: dark`) };
  const clicks = await ctx.frame.locator('body').evaluate((_el, index) => window.__v03RecordedClicks.slice(index), from);
  assert.deepEqual(clicks.map((x) => x.act), ['restore']);
  await nativeMode(page, 'light', 'light');
  palette.light = await nativePalette('light', `${label}: light`);
  return { clicks, palette };
}

try {
  const oldZip = join(dir, basename(zip));
  copyFileSync(zip, oldZip);
  assert.equal(file(oldZip).sha256, report.releaseZip.sha256);
  page.setDefaultTimeout(12_000);
  if (!wide || state.mode === 'web') await page.setViewportSize({ width: 1530, height: 950 });
  else assert.ok(state.screen, 'wide Electron acceptance needs an isolated desktop --screen');
  assert.deepEqual(snapFiles(ctx), {});
  for (const v of editions) {
    await nativeMode(page, v, v);
    const nativeLabel = await nativeTheme(page, v, builtinId(v));
    assert.equal(nativeLabel, 'OpenChamber');
    stock[v] = { root: await rootPaint(page), historical: await historicalSurface(page) };
    assert.ok(Object.keys(stock[v].historical).length >= 191 && Object.keys(stock[v].root.values).length >= 265);
    record('native-default-before-install', { variant: v, nativeLabel, nativeId: builtinId(v), ...stock[v] });
  }

  await install('0.3.1');
  await liveToggle(ctx, false);
  await act(ctx, 'load-preset', 'blue-etch').click();
  await saveAs(ctx, 'R031 Protected Pair');
  const protectedFiles = named();
  assert.equal(Object.keys(protectedFiles).length, 2);
  await liveToggle(ctx, true);
  for (const v of editions) {
    await nativeMode(page, v, v);
    const preview = await pick(v, 'tidemark');
    assert.equal(preview.metadata.id, builtinId(v));
    assert.deepEqual(preview.themeStudio.origin, { writer: preview.themeStudio.writer, raw: null });
  }
  const first = slots();
  await remove('0.3.1', 'dark');
  await install('0.3.1');
  for (const v of editions) assert.deepEqual(journal(v), { id: envelope(v).writer, raw: null });
  assert.deepEqual(slots(), first);
  await pictures('reopened');
  const clearEmpty = await clearFromFooter('no original file');
  for (const v of editions) {
    assert.equal(load(slotFile(ctx, v)).metadata.id, ownId(v));
    assert.match(envelope(v).writer, /^restored-/u);
    assert.equal(Object.hasOwn(envelope(v), 'origin'), false);
  }
  assert.deepEqual(named(), protectedFiles);
  record('one-click-from-absent-origin', { ...clearEmpty, slots: slots(), protectedFiles });

  const originalStamps = slots(), originals = Object.fromEntries(editions.map(v => [v, readFileSync(slotFile(ctx, v))]));
  for (const v of editions) {
    await nativeMode(page, v, v);
    const preview = await pick(v, 'tidemark');
    assert.equal(preview.metadata.id, builtinId(v));
    assert.deepEqual(preview.themeStudio.origin, { writer: preview.themeStudio.writer, raw: originals[v].toString('utf8') });
  }
  const second = slots(), originalWriters = Object.fromEntries(editions.map(v => [v, envelope(v).writer]));
  await remove('0.3.1', 'dark');
  await install('0.3.1');
  assert.deepEqual(slots(), second);
  for (const v of editions) {
    assert.deepEqual(journal(v), { id: originalWriters[v], raw: originals[v].toString('utf8') });
    await nativeMode(page, v, v);
    const { themeStudio } = await pick(v, 'hojicha');
    assert.equal(themeStudio.writer, originalWriters[v]);
    assert.deepEqual(themeStudio.origin, { writer: originalWriters[v], raw: originals[v].toString('utf8') });
  }
  const clearExact = await clearFromFooter('exact original bytes after continuing');
  for (const v of editions) assert.ok(readFileSync(slotFile(ctx, v)).equals(originals[v]), `original bytes restored ${v}`);
  assert.deepEqual(named(), protectedFiles);
  record('continued-after-reinstall-and-exact-byte-restore', { ...clearExact, before: originalStamps, after: slots(), protectedFiles });

  await removeIdleCandidate();
  await install('0.3.0');
  for (const v of editions) {
    await nativeMode(page, v, v);
    assert.equal((await pick(v, 'tidemark', true)).metadata.id, builtinId(v));
  }
  const oldSlots = slots();
  await remove('0.3.0', 'dark');
  await install('0.3.1');
  assert.deepEqual(slots(), oldSlots);
  await pictures('legacy-builtin');
  for (const v of [...editions].reverse()) {
    await nativeMode(page, v, v);
    const oldEditor = await sample(ctx);
    const from = await ctx.frame.locator('body').evaluate(() => window.__v03RecordedClicks.length);
    await act(ctx, 'recover-builtin').click();
    const palette = await nativePalette(v, `old 0.3.0 borrowed recovery ${v}`);
    const clicks = await ctx.frame.locator('body').evaluate((_el, index) => window.__v03RecordedClicks.slice(index), from);
    assert.deepEqual(clicks.map((x) => x.act), ['recover-builtin']);
    assert.deepEqual(await sample(ctx), oldEditor);
    assert.equal(load(slotFile(ctx, v)).metadata.id, ownId(v));
    assert.deepEqual(named(), protectedFiles);
    record('recovered-old-zip-borrowed', { variant: v, clicks, palette, editorUnchanged: true, slots: slots(), protectedFiles });
  }

  await removeIdleCandidate();
  await nativeTheme(page, 'light', ownId('light'));
  await install('0.3.0');
  assert.equal((await pick('light', 'tidemark', true)).metadata.id, ownId('light'));
  const oldSelf = snapFiles(ctx);
  await remove('0.3.0', 'light');
  await install('0.3.1');
  await pictures('legacy-preserve');
  await act(ctx, 'recovery-guide').click();
  const dialog = ctx.frame.getByRole('dialog', { name: 'Keep the current colors' });
  assert.match(await dialog.innerText(), /without deleting anything/u);
  await button(dialog, 'Done').click();
  assert.deepEqual(snapFiles(ctx), oldSelf);
  await nativeTheme(page, 'light', builtinId('light'));
  const palette = await nativePalette('light', 'switch away without deleting the old self-ID preview');
  assert.deepEqual(snapFiles(ctx), oldSelf);
  assert.deepEqual(named(), protectedFiles);
  record('old-self-id-kept', { palette, untouchedPreview: slots().light, protectedFiles });
  report.ok = true;
  console.log(`${name}: native uninstall/reinstall, both-mode origin and old ZIP paths verified (${report.screenshots.length} screenshots)`);
} catch (error) {
  report.ok = false;
  report.error = (error.stack ?? String(error)).replace(/\/api\/guest-files\/[^/\s"']+/gu, '/api/guest-files/[fixture-asset-grant]');
  if (await iframe.isVisible()) await iframe.screenshot({ path: join(evidence, `${name}-failure.png`) }).catch(() => {});
  throw error;
} finally {
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  try {
    if (report.ok && wide) {
      const { verifyWideGrids } = await import('./verify-r031w-grids.mjs');
      const served = report.steps.findLast(step => step.stage === 'loaded-actual-iframe-assets').files;
      await verifyWideGrids(ctx, { name, fixture, fixtureFiles, served, nativeHostVersion: report.nativeHostVersion });
    }
  } finally { await app.close(); }
}

async function removeIdleCandidate() {
  const before = snapFiles(ctx);
  await settings(page, 'extensions');
  await button(page, /Theme Studio Folder · v0\.3\.1/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeInstaller();
  await iframe.waitFor({ state: 'detached' });
  assert.deepEqual(snapFiles(ctx), before);
  assert.equal(file(storagePath), null);
}
