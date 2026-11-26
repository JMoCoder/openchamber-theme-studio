import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, closeSettings, curated, defaults, eventually, expectPaint,
  expectedPaint, file, mount, nativeMode, nativeTheme, painted, paintSummary, rootPaint, run, sample,
  settings, show, slotFile, snapFiles, stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance, suite = 'live'] = process.argv.slice(2);
assert.ok(['live', 'remove', 'clean-remove', 'decline'].includes(suite));
await run(instance, suite, async ctx => {
  const { page } = ctx;
  const issues = [];
  const check = async (name, fn) => {
    try { ctx.record('failure-path-case', { name, ok: true, detail: await fn() }); }
    catch (e) {
      issues.push(name);
      ctx.record('failure-path-case', { name, ok: false, error: e.message.replace(/\/api\/guest-files\/[^/\s"']+/gu, '/api/guest-files/[fixture-asset-grant]'),
        shot: await ctx.shot(`${name}-failed`).catch(() => null) });
    }
  };
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  await nativeTheme(page, 'dark', 'openchamber-dark');
  const stock = await rootPaint(page);
  if (suite === 'decline') {
    const prompt = await addFromSettings(ctx, '0.3.0', false);
    const info = await prompt.ariaSnapshot();
    await page.keyboard.press('Escape');
    await prompt.waitFor({ state: 'hidden' });
    await page.getByText('Needs approval', { exact: true }).waitFor();
    await closeSettings(page);
    const panel = page.locator('iframe[title="Theme Studio"]');
    await panel.waitFor({ state: 'hidden' });
    ctx.record('declined-native-approval', { info, approvalState: 'Needs approval', panelLoaded: false,
      canEvaluateSample: false, files: snapFiles(ctx) });
    await ctx.shot('declined-no-panel');
    return;
  }
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await show(ctx, 'theme');
  if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  const pick = (id, v = 'light') => expectPaint(ctx, { label: `${id}-${v}`, trigger: () => act(ctx, 'load-preset', id).click(),
    def: curated(id, v), mode: 'light', edit: v });
  await pick('tidemark');
  if (suite.endsWith('remove')) {
    if (suite === 'clean-remove') {
      await act(ctx, 'restore').click();
      await eventually(async () => JSON.stringify((await rootPaint(page)).values) === JSON.stringify(stock.values),
        'rendered stock again after Restore');
    }
    const before = { slot: themeSummary(ctx, 'light'), window: paintSummary(await rootPaint(page)) };
    await settings(page, 'extensions');
    await button(page, /Theme Studio Folder · v0\.3\.0/u).click();
    await button(page, 'Remove Theme Studio').click();
    const confirm = button(page, 'Remove').filter({ visible: true });
    if (await confirm.waitFor({ timeout: 1500 }).then(() => true, () => false)) await confirm.click();
    await page.getByText('No extensions loaded.', { exact: true }).waitFor();
    await closeSettings(page);
    await page.locator('iframe[title="Theme Studio"]').waitFor({ state: 'hidden' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await eventually(async () => (await rootPaint(page)).mode === 'light', 'renderer after removing');
    await delay(3500);
    const after = await rootPaint(page);
    const equal = JSON.stringify(after.values) === JSON.stringify(stock.values);
    const screenshot = await ctx.shot(equal ? 'native-colors' : 'preview-colors-left');
    ctx.record('native-uninstall', { before, after: paintSummary(after), matchesNative: equal, original: paintSummary(stock),
      stockMode: stock.mode, slotAfter: themeSummary(ctx, 'light'), sidebarGone: !await button(page, 'Theme Studio').isVisible(), screenshot });
    assert.ok(equal, 'native uninstall retained the active borrowed theme even after reload');
    return;
  }

  await check('timeout-then-rewrite', async () => {
    const lookup = url => url.pathname === '/api/config/themes';
    let release, reads = 0;
    let wait = new Promise(resolve => { release = resolve; });
    const block = async route => {
      if (wait && route.request().method() === 'GET') { reads++; await wait; }
      await route.fallback();
    };
    await page.route(lookup, block);
    const resume = () => { wait = null; release(); };
    try {
      const paintedBefore = await rootPaint(page);
      await variant(ctx, 'dark').click();
      await eventually(() => reads > 0, 'host watcher reached actual GET, held only at renderer');
      await ctx.frame.locator('.connection[data-sync=timeout]').waitFor({ timeout: 18_000 });
      const stale = themeSummary(ctx, 'light');
      const ap = await stateLine(ctx);
      const screenshot = await ctx.shot('receipt-timed-out');
      assert.equal(stale.variant, 'dark');
      assert.deepEqual((await rootPaint(page)).values, paintedBefore.values);
      await act(ctx, 'load-preset', 'kilnmark').click();
      const disk = await eventually(() => {
        const t = themeSummary(ctx, 'light');
        return t.sha256 !== stale.sha256 && t.origin.ref === 'kilnmark' && t.variant === 'dark' && t;
      }, 'a new selection actually rewrites the on-disk slot before a confirmation');
      assert.deepEqual((await rootPaint(page)).values, paintedBefore.values);
      resume();
      const paintedAfter = await eventually(async () => {
        const r = await rootPaint(page);
        return r.mode === 'light' && painted(r, expectedPaint(curated('kilnmark', 'dark'), 'light')) && r;
      }, 'real renderer sees latest kilnmark after release');
      return { reads, timeout: ap, fileBefore: stale, fileAfter: disk, after: paintSummary(paintedAfter), screenshot };
    } finally { resume(); await page.unroute(lookup, block); }
  });

  await check('manual-dark-light-no-writes', async () => {
    const before = snapFiles(ctx);
    const light = await rootPaint(page);
    const dark = await nativeMode(page, 'dark', 'light');
    await mount(ctx);
    await delay(2900);
    const darkActual = await rootPaint(page);
    assert.ok(painted(darkActual, expectedPaint(defaults('dark'))));
    assert.deepEqual(snapFiles(ctx), before);
    await nativeMode(page, 'light', 'dark');
    await mount(ctx);
    await delay(2900);
    assert.deepEqual(snapFiles(ctx), before);
    assert.deepEqual((await rootPaint(page)).values, light.values);
    return { observedDark: dark, filesUnchanged: before, light: paintSummary(light) };
  });

  await check('two-panels', async () => {
    const peerPage = await ctx.context.newPage();
    const peer = { ...ctx, page: peerPage };
    try {
      await peerPage.goto(ctx.state.url, { waitUntil: 'domcontentloaded' });
      await mount(peer);
      await show(peer, 'theme');
      await show(ctx, 'theme');
      if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
      const onA = await pick('afterglow');
      const onB = await eventually(async () => {
        const r = await rootPaint(peerPage);
        return r.mode === 'light' && painted(r, expectedPaint(curated('afterglow', 'light'))) && r;
      }, 'other renderer receives actual borrowed theme');
      const fileA = file(slotFile(ctx, 'light'));
      const peerEdit = await variant(peer, 'light').getAttribute('aria-pressed') === 'true' ? 'light' : 'dark';
      await act(peer, 'load-preset', 'hojicha').click();
      const secondSample = await eventually(async () => {
        const s = await sample(peer);
        return s.background === curated('hojicha', peerEdit).colors.surface.background && s;
      }, 'second panel changes its draft');
      await delay(5200);
      const fileB = file(slotFile(ctx, 'light'));
      const changed = fileB.sha256 !== fileA.sha256;
      const final = [await rootPaint(page), await rootPaint(peerPage)];
      const bStatus = await stateLine(peer);
      const current = changed ? expectedPaint(curated('hojicha', peerEdit), 'light') : expectedPaint(curated('afterglow', 'light'));
      const summary = { paletteFromA: [onA.data.after, paintSummary(onB)], secondSample,
        peerEdit, secondChangedFile: changed, bStatus, fileA, fileB, final: final.map(paintSummary),
        peerShot: await ctx.shot('peer-panel-second-pick', peerPage) };
      ctx.record('two-panels-observed', summary);
      assert.ok(final.every(r => painted(r, current)), 'both windows must agree with the chosen file');
      if (!changed) assert.match(bStatus.text, /changed somewhere else|panel(?: preview)? only/iu);
      return summary;
    } finally { await peerPage.close(); }
  });

  await check('external-change-not-overwritten', async () => {
    const p = slotFile(ctx, 'light');
    assert.equal(realpathSync(p), p, 'modifies only deliberately isolated test file');
    assert.ok(p.startsWith(joinFixture(ctx)));
    const original = readFileSync(p);
    const external = Buffer.concat([original, Buffer.from('\n   \n')]);
    // A second actor's ordinary file edit, not a plugin API call or fixture
    // metadata spoof; white space intentionally preserves the real palette.
    writeFileSync(p, external);
    await delay(2200);
    const disk = file(p), r = await rootPaint(page);
    await act(ctx, 'load-preset', 'blue-etch').click();
    await delay(4100);
    const status = await stateLine(ctx);
    const shot = await ctx.shot('external-file-conflict');
    assert.deepEqual(file(p), disk);
    assert.deepEqual((await rootPaint(page)).values, r.values);
    assert.match(status.text, /changed somewhere else/iu);
    return { before: disk, after: file(p), status, shot };
  });
  assert.deepEqual(issues, [], 'only explicitly verified fault cases reported passing');
});

function joinFixture(ctx) { return `${ctx.state.dir}/home/.config/openchamber/themes/`; }
