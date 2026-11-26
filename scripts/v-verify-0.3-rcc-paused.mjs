// Real named theme that is an exact native-palette twin. Verify the new
// bilingual paused copy at 320 CSS pixels and follow its Restore-first order.
import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, closeSettings, curated, evidence, eventually, historicalSurface, identical,
  language, liveToggle, load, mount, nativeMode, nativeTheme, paintSummary, rootPaint, run, saveAs, settings,
  show, snapFiles, stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [name, resume] = process.argv.slice(2);
assert.equal(name, 'v03c-wnamed');
assert.ok(!resume || resume === 'paused-confirm');
const restore = ctx => act(ctx, 'restore');
const names = files => Object.fromEntries(Object.entries(files).filter(([f]) => /^theme-studio-v03c-/u.test(f)));
const block = ctx => ctx.frame.locator('.u-banner').filter({ visible: true });
async function makeNarrow(ctx) {
  const frame = ctx.page.locator('iframe[title="Theme Studio"]');
  for (let i = 0; i < 4; i++) {
    const box = await frame.boundingBox();
    if (Math.abs(box.width - 320) < .5) return box.width;
    const grip = await ctx.page.locator('[data-context-zone=right][data-context-panel-open=true] > [role=separator]').boundingBox();
    const x = grip.x + grip.width / 2, y = grip.y + 43;
    await ctx.page.mouse.move(x, y);
    await ctx.page.mouse.down();
    await ctx.page.mouse.move(x + box.width - 320, y, { steps: 12 });
    await ctx.page.mouse.up();
    await delay(120);
  }
  throw new Error('Native splitter did not reach 320px iframe');
}
async function readBanner(ctx, locale) {
  const zh = locale === 'zh';
  await eventually(async () => (await stateLine(ctx)).text === (zh ? '整窗预览已暂停' : 'Window preview paused'),
    `actual paused state in ${locale}`);
  await block(ctx).waitFor();
  const banner = await block(ctx).evaluate(el => {
    const win = el.ownerDocument.defaultView;
    const bounds = el.getBoundingClientRect(), range = el.ownerDocument.createRange();
    const walker = el.ownerDocument.createTreeWalker(el, win.NodeFilter.SHOW_TEXT);
    const glyphs = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      glyphs.push(...[...range.getClientRects()].map(r => r.toJSON()));
    }
    const isInside = glyphs.every(r => r.left >= bounds.left - .75 && r.right <= bounds.right + .75 &&
      r.top >= bounds.top - .75 && r.bottom <= bounds.bottom + .75);
    const footer = el.ownerDocument.querySelector('footer [data-act=restore]')?.getBoundingClientRect();
    return { text: el.innerText, bounds: bounds.toJSON(), width: win.innerWidth, glyphs, isInside,
      footer: footer?.toJSON(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  assert.equal(banner.width, 320);
  assert.match(banner.text, zh ? /试色文件仍在。请先点「还原」撤下试色/u :
    /the trial file is still in place\. Choose Restore before picking a different palette/iu);
  assert.ok(banner.isInside && banner.glyphs.length > 1 && banner.scrollWidth <= banner.clientWidth + 1,
    'full wrapped warning text, with no clipped glyphs');
  assert.ok(banner.footer && banner.bounds.bottom < banner.footer.top && banner.footer.bottom < 860);
  assert.equal(await restore(ctx).isVisible(), true);
  assert.equal(await restore(ctx).isEnabled(), true);
  await ctx.shot(`${locale}-320-paused-restore-first`);
  ctx.record('visible-narrow-paused-message', { locale, ...banner, state: await stateLine(ctx) });
}

await run(name, resume || 'paused-copy', async ctx => {
  const { page } = ctx;
  assert.equal(ctx.report.candidateProfile, 'rc03c');
  if (resume) {
    const prior = load(`${evidence}/${name}-paused-copy.json`);
    assert.deepEqual(prior.candidateBefore, ctx.report.candidateBefore);
    const checked = prior.steps.find(s => s.stage === 'paused-warning-read-only');
    const backup = names(checked.initiallyOnlyNamed), slot = themeSummary(ctx, 'light');
    assert.ok(checked && prior.screenshots.some(s => s.name.endsWith('-one-restore-removes-shadow-preserves-named.jpg')));
    assert.equal(slot.metadata.id, 'theme-studio-live-light');
    assert.deepEqual(names(snapFiles(ctx)), backup);
    // Verify persisted restored original from the original restored scene,
    // avoiding the interrupted harness's native Close Settings control.
    await settings(page, 'appearance');
    await button(page.getByRole('group', { name: 'Themes', exact: true }), 'Light').click();
    const row = page.getByRole('listbox', { name: 'Light theme', exact: true })
      .locator('[role=option][data-theme-id="openchamber-light"]');
    if (await row.getAttribute('aria-selected') !== 'true') await row.click();
    await eventually(async () => (await row.getAttribute('aria-selected')) === 'true', 'native OpenChamber selected after manually removing the trial');
    const nativeName = (await row.innerText()).trim();
    assert.equal(nativeName, 'OpenChamber');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const r = await eventually(async () => {
      const now = await rootPaint(page);
      return paintSummary(now).hash === checked.stock.hash && now;
    }, 'native persisted colors match 265/265 stock after one Restore');
    assert.equal(Object.keys(await historicalSurface(page)).length, 191);
    assert.deepEqual(names(snapFiles(ctx)), backup);
    await ctx.shot('native-color-restored-no-named-write');
    ctx.record('single-restore-confirmation', { stock: checked.stock, current: paintSummary(r), nativeName,
      slot, historicalCount: 191, namedBefore: backup, namedAfter: names(snapFiles(ctx)), restoresDispatchedHere: 0 });
    return;
  }
  assert.deepEqual(snapFiles(ctx), {});
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  const stock = await rootPaint(page), historical = await historicalSurface(page);
  assert.equal(Object.keys(historical).length, 191);
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await show(ctx, 'theme');
  assert.equal(await variant(ctx, 'light').getAttribute('aria-pressed'), 'true');
  await liveToggle(ctx, false);
  await act(ctx, 'load-default').click();
  await saveAs(ctx, 'V03C Own Pair');
  await liveToggle(ctx, true);
  const initialNamed = names(snapFiles(ctx));
  assert.equal(Object.keys(initialNamed).length, 2);
  const label = await nativeTheme(page, 'light', 'theme-studio-v03c-own-pair-light');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await mount(ctx);
  const establish = await rootPaint(page);
  assert.deepEqual(await historicalSurface(page), historical, 'named fixture is a true light-palette twin');
  const allBefore = snapFiles(ctx);
  await makeNarrow(ctx);
  await show(ctx, 'theme');
  await act(ctx, 'load-preset', 'afterglow').click();
  const seenAt = performance.now();
  await readBanner(ctx, 'en');
  const borrowed = themeSummary(ctx, 'light');
  assert.equal(borrowed.metadata.id, 'openchamber-light');
  assert.equal(borrowed.canvas, curated('afterglow', 'light').colors.surface.background);
  const probed = snapFiles(ctx), noExtra = [];
  const paintNamed = await rootPaint(page);
  assert.deepEqual(paintNamed.values, establish.values);
  assert.deepEqual(names(probed), initialNamed);
  const w = watch(ctx.themes, (event, n) => { if (n) noExtra.push([event, n]); });
  try {
    await language(ctx, 'zh');
    await makeNarrow(ctx);
    await readBanner(ctx, 'zh');
    await delay(850);
    const afterStrings = snapFiles(ctx);
    const afterPaint = await rootPaint(page);
    ctx.record('paused-warning-read-only', { label, trial: borrowed, initiallyOnlyNamed: allBefore, afterProbe: probed,
      afterLocaleSwitch: afterStrings, repeatWrites: noExtra, noWindowChange: identical(paintNamed.values, afterPaint.values),
      elapsedFromFirstClickMs: Math.round(performance.now() - seenAt), stock: paintSummary(stock) });
    assert.deepEqual(noExtra, []);
    assert.deepEqual(afterStrings, probed);
    assert.deepEqual(afterPaint.values, paintNamed.values);
  } finally { w.close(); }

  // Follow the warning literally: Restore while the named theme is STILL
  // selected, before touching the Appearance preference.
  await restore(ctx).click();
  const own = await eventually(() => {
    const current = themeSummary(ctx, 'light');
    return current?.metadata.id === 'theme-studio-live-light' && current;
  }, 'single footer Restore retires native-ID trial while named theme stays selected', 18_000);
  const currentHistorical = await historicalSurface(page);
  assert.deepEqual(currentHistorical, historical);
  assert.deepEqual(names(snapFiles(ctx)), initialNamed);
  await ctx.shot('one-restore-removes-shadow-preserves-named');
  await language(ctx, 'en');
  const nativeName = await nativeTheme(page, 'light', 'openchamber-light');
  const r = await eventually(async () => {
    const now = await rootPaint(page);
    return identical(now.values, stock.values) && now;
  }, 'native row is restored and actual colors are original');
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: 'Themes', exact: true }), 'Light').click();
  const row = page.getByRole('listbox', { name: 'Light theme', exact: true })
    .locator('[role=option][data-theme-id="openchamber-light"]');
  assert.equal(await row.getAttribute('aria-selected'), 'true');
  assert.equal((await row.innerText()).trim(), 'OpenChamber');
  await closeSettings(page);
  ctx.record('single-guided-restore-succeeded', { stock: paintSummary(stock), current: paintSummary(r), nativeName,
    afterRestoreSlot: own, historicalCount: Object.keys(currentHistorical).length, namedBefore: initialNamed, namedAfter: names(snapFiles(ctx)) });
});
