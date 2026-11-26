// Independent black-box verification of saved works / explicitly selected
// Studio slots. Never call an extension API or pass a synthetic ready packet.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import {
  act, addFromSettings, assetsMatch, candidate, curated, defaults, editions, eventually,
  expectPaint, expectedPaint, file, load, mount, nativeMode, nativeTheme, painted, paintSummary, restore, rootPaint,
  run, sample, saveAs, settings, show, slotFile, snapFiles, stateLine, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance] = process.argv.slice(2);
const title = 'V03 personal pair';
const namedId = v => `theme-studio-v03-personal-pair-${v}`;
const studioSlot = v => `theme-studio-live-${v}`;
await run(instance, process.env.V03_RUN_ID ?? 'ownership', async ctx => {
  const { page } = ctx;
  const getPath = v => join(ctx.themes, `${namedId(v)}.json`);
  const named = () => Object.fromEntries(editions.map(v => [v, file(getPath(v))]));
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  await nativeTheme(page, 'dark', 'openchamber-dark');
  const stock = await rootPaint(page);
  assert.ok(painted(stock, expectedPaint(defaults('light'))));
  const resume = process.env.V03_OWNERSHIP_RESUME === '1';
  if (!resume) await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  if (!resume) await assetsMatch(ctx, candidate);
  await show(ctx, 'theme');
  let saveText;
  if (!resume) {
    await expectPaint(ctx, { label: '取焙茶为两版的保存源', trigger: () => act(ctx, 'load-preset', 'hojicha').click(),
      mode: 'light', edit: 'light', def: curated('hojicha', 'light') });
    saveText = await saveAs(ctx, title);
    await restore(ctx, stock, 'theme before experiments');
  }
  const original = named();
  assert.ok(Object.values(original).every(Boolean));
  ctx.record('saved-by-ui', { message: saveText, named: original });
  assert.ok(painted(await rootPaint(page), expectedPaint(defaults('light'))));

  const labels = {};
  for (const v of editions) labels[v] = await nativeTheme(page, v, namedId(v));
  // Reload remounts the actual pane regardless of the host's empty-project
  // rail toggle behavior, while retaining the native choices on disk.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await mount(ctx);
  const beforeNamed = await eventually(async () => {
    const r = await rootPaint(page);
    return painted(r, expectedPaint(load(getPath('light')))) && r;
  }, 'saved light selected in native appearance');
  const namedDisk = snapFiles(ctx);
  await show(ctx, 'theme');
  await act(ctx, 'load-preset', 'afterglow').click();
  await eventually(async () => (await sample(ctx)).background === curated('afterglow', 'light').colors.surface.background,
    'saved-theme case editor changes to Afterglow');
  await variant(ctx, 'dark').click();
  await act(ctx, 'load-preset', 'tidemark').click();
  await eventually(async () => (await sample(ctx)).background === curated('tidemark', 'dark').colors.surface.background,
    'saved-theme case editor changes to dark Tidemark');
  await delay(3100);
  const namedStatus = await stateLine(ctx);
  await ctx.shot('native-saved-unchanged');
  ctx.record('native-named-selection', {
    labels, original, after: named(), diskBefore: namedDisk, diskAfter: snapFiles(ctx),
    hostBefore: paintSummary(beforeNamed), hostAfter: paintSummary(await rootPaint(page)),
    sample: await sample(ctx), status: namedStatus,
  });
  assert.deepEqual(named(), original);
  assert.deepEqual(snapFiles(ctx), namedDisk);
  assert.deepEqual((await rootPaint(page)).values, beforeNamed.values);
  assert.match(namedStatus.text, /panel preview only|samples only/iu);

  // The previous Restore retired the borrowed ID; this is a real, selectable
  // theme-studio-live-light in the native appearance list, not a shadow ID.
  assert.equal(load(slotFile(ctx, 'light')).metadata.id, studioSlot('light'));
  const slotTitle = await nativeTheme(page, 'light', studioSlot('light'));
  await mount(ctx);
  await delay(220);
  const beforeSlot = { status: await stateLine(ctx), files: snapFiles(ctx), window: await rootPaint(page) };
  ctx.record('native-slot-selected', { title: slotTitle, status: beforeSlot.status, named: named() });
  if (await variant(ctx, 'dark').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'dark').click();
  if (beforeSlot.status.text === 'Panel preview only') {
    await act(ctx, 'load-preset', 'afterglow').click();
    await delay(5000);
    const now = await rootPaint(page);
    await ctx.shot('neutral-live-slot-unrecognized');
    ctx.record('native-neutral-slot-unrecognized', {
      statusBefore: beforeSlot.status, statusAfter: await stateLine(ctx), sample: await sample(ctx),
      diskBefore: beforeSlot.files, diskAfter: snapFiles(ctx), hostWas: paintSummary(beforeSlot.window),
      hostIs: paintSummary(now), named: named(),
    });
    assert.deepEqual(named(), original);
    assert.ok(painted(now, expectedPaint(curated('afterglow', 'dark'), 'light')),
      'explicitly selected native Studio slot, but only the sample changed');
    return;
  }
  await expectPaint(ctx, { label: '明确选用工坊实时浅槽 → 晚照深', trigger: () => act(ctx, 'load-preset', 'afterglow').click(),
    mode: 'light', edit: 'dark', def: curated('afterglow', 'dark') });
  assert.equal(load(slotFile(ctx, 'light')).metadata.id, studioSlot('light'));
  await expectPaint(ctx, { label: '明确选用工坊实时浅槽 → 标签转浅', trigger: () => variant(ctx, 'light').click(),
    mode: 'light', edit: 'light', def: curated('afterglow', 'light') });
  await expectPaint(ctx, { label: '明确选用工坊实时浅槽 → 澄潮浅', trigger: () => act(ctx, 'load-preset', 'tidemark').click(),
    mode: 'light', edit: 'light', def: curated('tidemark', 'light') });
  const slotStatus = await eventually(async () => {
    const s = await stateLine(ctx);
    return s.sync === 'applied' && s;
  }, 'slot confirmation shown in UI');
  await ctx.shot('live-slot-applied');
  ctx.record('native-live-selection', { mode: 'light', status: slotStatus, named: named(), disk: snapFiles(ctx) });
  assert.deepEqual(named(), original);

  // Both objects deliberately share the same input palette here, unlike the
  // first check. Record what really happens; do not infer host identity from
  // the iframe's colour-matching status text.
  await expectPaint(ctx, { label: '令实时浅槽与另存焙茶浅同色', trigger: () => act(ctx, 'load-preset', 'hojicha').click(),
    mode: 'light', edit: 'light', def: curated('hojicha', 'light') });
  await nativeTheme(page, 'light', namedId('light'));
  await mount(ctx);
  const twinRoot = await rootPaint(page);
  const twinSlot = file(slotFile(ctx, 'light'));
  const twinStatus = await stateLine(ctx);
  await act(ctx, 'load-preset', 'blue-etch').click();
  await delay(3500);
  const changed = file(slotFile(ctx, 'light'));
  const early = await stateLine(ctx);
  let end = early;
  if (changed.sha256 !== twinSlot.sha256) {
    end = await eventually(async () => {
      const s = await stateLine(ctx);
      return s.sync === 'timeout' && s;
    }, 'active named twin cannot confirm a write to the inactive Studio slot', 18_000);
  }
  const namedTwinReport = { statusBefore: twinStatus, status3s: early, end, before: twinSlot, after: changed,
    hostBefore: paintSummary(twinRoot), hostAfter: paintSummary(await rootPaint(page)), named: named(),
    namedRootUnchanged: JSON.stringify((await rootPaint(page)).values) === JSON.stringify(twinRoot.values),
  };
  await ctx.shot('same-colour-named-work');
  ctx.record('same-colour-explicit-named-selection', namedTwinReport);
  assert.deepEqual(named(), original);
  assert.deepEqual((await rootPaint(page)).values, twinRoot.values);
});
