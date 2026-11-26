// Independent rc03b targeted replay. Mouse clicks on the native host and
// guest panel drive the experiment. Only the copy staged in a private
// fixture is replaced, and only after the old UI created the migration state.
import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assertPackage, assetsMatch, button, candidate, cap, closeSettings, curated, defaults,
  eventually, evidence, expectPaint, expectedPaint, file, historicalSurface, identical, liveToggle, load, mount,
  nativeMode, nativeTheme, paintDiff, painted, paintSummary, priorCandidate, replaceFixtureExtension, rootPaint,
  run, sample, saveAs, settings, show, slotFile, snapFiles, stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance, experiment] = process.argv.slice(2);
assert.ok(['clean', 'old-default', 'old-slot', 'named', 'named-follow', 'named-after-restore'].includes(experiment));
const version = '0.3.0';
const nativeId = 'openchamber-light', ownId = 'theme-studio-live-light';
const registry = ctx => file(join(ctx.state.openchamberData, 'extensions.json'));
const originalBackup = ctx => file(join(ctx.state.openchamberData, 'guest-storage/theme-studio.json'));
const namedWorks = ctx => Object.fromEntries(Object.entries(snapFiles(ctx)).filter(([k]) => !/^theme-studio-live-(?:light|dark)\.json$/u.test(k)));

async function selected(page) {
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: 'Themes', exact: true }), cap('light')).click();
  const item = page.getByRole('listbox', { name: 'Light theme', exact: true }).locator('[role=option][aria-selected=true]');
  const result = { id: await item.getAttribute('data-theme-id'), title: (await item.innerText()).trim() };
  await closeSettings(page);
  return result;
}
function watchThemes(ctx) {
  const changes = [], start = performance.now();
  const w = watch(ctx.themes, (event, name) => {
    if (name) changes.push({ at: Math.round(performance.now() - start), event, name });
  });
  return { changes, stop: () => w.close() };
}
async function snapshot(ctx) {
  const root = await rootPaint(ctx.page), historical = await historicalSurface(ctx.page);
  return { root, historical, summary: paintSummary(root), files: snapFiles(ctx), registry: registry(ctx),
    storage: originalBackup(ctx), slot: themeSummary(ctx, 'light') };
}
const sameBytes = (a, b) => a === null && b === null || a?.sha256 === b?.sha256 && a?.size === b?.size;
const mismatches = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k])
  .map(k => [k, a[k] ?? null, b[k] ?? null]);
async function assertNativeColors(ctx, original, label) {
  const now = await snapshot(ctx);
  const historical = mismatches(original.historical, now.historical);
  const generated = mismatches(original.root.values, now.root.values);
  ctx.record(label, { expected: original.summary, actual: now.summary, historicalCount: Object.keys(original.historical).length,
    historical, generated, disk: now.files, slot: now.slot });
  assert.equal(now.root.mode, 'light');
  assert.equal(Object.keys(original.historical).length, 191);
  assert.deepEqual(historical, [], `${label} restored the historical native surface`);
  return now;
}
async function oneRestore(ctx, to, label, originalSlotMustMatch = false) {
  const before = await snapshot(ctx), stamp = performance.now();
  const expectedSlot = to.slot;
  const clickList = ctx.frame.locator('body');
  const from = await clickList.evaluate(() => window.__v03RecordedClicks.length);
  await act(ctx, 'restore').click();
  const out = await clickList.evaluate((_b, start) => window.__v03RecordedClicks.slice(start), from);
  assert.deepEqual(out.map(evt => evt.act), ['restore']);
  let confirmed;
  try {
    confirmed = await eventually(async () => {
      const now = await rootPaint(ctx.page);
      const historical = await historicalSurface(ctx.page);
      return identical(historical, to.historical) && now.mode === to.root.mode &&
        (!originalSlotMustMatch || sameBytes(themeSummary(ctx, 'light'), expectedSlot)) && now;
    }, label, 18_500);
  } catch (error) {
    ctx.record('restore-no-recovery', { label, before: before.summary, expected: to.summary,
      after: await snapshot(ctx), state: await stateLine(ctx), edited: await sample(ctx) });
    throw error;
  }
  const after = await assertNativeColors(ctx, to, label);
  if (originalSlotMustMatch) assert.ok(sameBytes(after.slot, expectedSlot), 'exact predecessor slot bytes');
  assert.deepEqual(namedWorks(ctx), Object.fromEntries(Object.entries(before.files).filter(([k]) =>
    !/^theme-studio-live-(?:light|dark)\.json$/u.test(k))), 'Restore did not alter named-work bytes or mtime');
  ctx.record('restore-success', { label, elapsedMs: Math.round(performance.now() - stamp), actual: paintSummary(confirmed),
    beforeSlot: before.slot, predecessorSlot: expectedSlot, afterSlot: after.slot, state: await stateLine(ctx), trustedClick: out ?? null,
    requiredSlotByteEquality: originalSlotMustMatch, exactPredecessorSlotBytes: sameBytes(after.slot, expectedSlot) });
  return after;
}
async function reopenQuiet(ctx, newBytes = false, guardMs = 2600) {
  const before = await snapshot(ctx);
  const offset = ctx.assets.length;
  const w = watchThemes(ctx);
  try {
    await ctx.page.reload({ waitUntil: 'domcontentloaded' });
    await mount(ctx);
    if (newBytes) await assetsMatch(ctx, candidate, offset);
    await delay(guardMs);
    const after = await snapshot(ctx);
    ctx.record('reopen-observed-without-edit', { themeFsEvents: w.changes, before: before.files, after: after.files,
      registryUnchanged: identical(before.registry, after.registry), storageUnchanged: identical(before.storage, after.storage),
      windowBefore: before.summary, windowAfter: after.summary, panel: await stateLine(ctx), draft: await sample(ctx), guardMs });
    assert.deepEqual(w.changes, [], 'an opening alone must not write the theme directory');
    assert.deepEqual(after.files, before.files, 'opening must not write');
    assert.deepEqual(after.registry, before.registry, 'native registration and grants preserved');
    assert.deepEqual(after.root.values, before.root.values, 'opening alone did not change the host appearance');
    return after;
  } finally { w.stop(); }
}
async function edition(ctx, v) {
  if (await variant(ctx, v).getAttribute('aria-pressed') !== 'true') await variant(ctx, v).click();
  await eventually(async () => (await variant(ctx, v).getAttribute('aria-pressed')) === 'true', `editor ${v}`);
}
const pick = (ctx, id, edit, label) => expectPaint(ctx, {
  label, trigger: () => act(ctx, 'load-preset', id).click(),
  def: curated(id, edit), mode: 'light', edit, timeout: 20_000,
});

await run(instance, experiment, async ctx => {
  const { page } = ctx;
  const build = ctx.report.candidateProfile;
  assert.ok(build === 'rc03b' || build === 'rc03c' && experiment === 'clean');
  if (experiment === 'named-after-restore') {
    const stock = load(join(evidence, `${instance}-named.json`)).steps.find(s => s.stage === 'stock-before-install').snapshot;
    const prior = load(join(evidence, `${instance}-named-follow.json`));
    assert.ok(prior.ok);
    const kept = namedWorks(ctx);
    assert.equal((await selected(page)).id, nativeId);
    await reopenQuiet(ctx, true);
    const initial = await assertNativeColors(ctx, stock, 'named-probe-human-restore-is-still-native');
    assert.equal(initial.slot.metadata.id, ownId);
    assert.deepEqual(initial.root.values, stock.root.values);
    await show(ctx, 'theme');
    await edition(ctx, 'light');
    await pick(ctx, 'tidemark', 'light', 'new deliberate Tidemark preview after manually restoring the unconfirmed probe');
    await ctx.shot('new-active-preview-after-manual-restore');
    await oneRestore(ctx, stock, 'after-new-preview-returns-native');
    const end = await snapshot(ctx);
    assert.equal(end.slot.metadata.id, ownId);
    assert.deepEqual(namedWorks(ctx), kept);
    ctx.record('named-probe-remains-recoverable-and-reusable', { before: initial.slot, after: end.slot,
      names: kept, finalWindow: end.summary, nativeSelected: await selected(page) });
    await ctx.shot('returns-native-again');
    return;
  }
  if (experiment === 'named-follow') {
    const history = load(join(evidence, `${instance}-named.json`));
    const stock = history.steps.find(s => s.stage === 'stock-before-install').snapshot;
    const appeared = history.steps.find(s => s.stage === 'same-palette-named-theme-after-first-click');
    const name = 'theme-studio-v03b-same-color-light';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mount(ctx);
    await assetsMatch(ctx, candidate);
    await show(ctx, 'theme');
    assert.equal((await selected(page)).id, name);
    assert.deepEqual(snapFiles(ctx), appeared.after);
    const kept = namedWorks(ctx);
    const w = watchThemes(ctx);
    try {
      const before = await snapshot(ctx);
      await act(ctx, 'load-preset', 'hojicha').click();
      await eventually(async () => (await sample(ctx)).background === curated('hojicha', 'light').colors.surface.background,
        'post-reopen second click changes only draft');
      await delay(13_300);
      const after = await snapshot(ctx);
      ctx.record('second-choice-after-reopen', { state: await stateLine(ctx), fsEvents: w.changes,
        before: before.files, after: after.files, realBefore: before.summary, realAfter: after.summary });
      assert.deepEqual(w.changes, []);
      assert.deepEqual(after.files, before.files);
      assert.deepEqual(after.root.values, before.root.values);
    } finally { w.stop(); }
    const row = await nativeTheme(page, 'light', nativeId);
    await eventually(async () => (await rootPaint(page)).values['--surface-background'], 'after native return');
    await delay(1200);
    const returnNative = await snapshot(ctx);
    await ctx.shot('return-to-native-while-probe-is-on-disk');
    ctx.record('return-to-native-after-unconfirmed-probe', { row, current: returnNative.summary,
      original: stock.summary, deviation: mismatches(stock.historical, returnNative.historical),
      file: returnNative.slot, selected: await selected(page), state: await stateLine(ctx) });
    await oneRestore(ctx, stock, 'is-probe-recoverable-by-one-restore');
    await ctx.shot('restore-will-clean-unconfirmed-probe');
    assert.deepEqual(namedWorks(ctx), kept);
    return;
  }
  assert.deepEqual(snapFiles(ctx), {});
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', nativeId);
  const stock = await snapshot(ctx);
  assert.ok(painted(stock.root, expectedPaint(defaults('light'))));
  ctx.record('stock-before-install', { snapshot: stock });
  const fromOld = experiment.startsWith('old-');
  if (fromOld) assertPackage('rc03');
  await addFromSettings(ctx, version);
  await mount(ctx);
  await assetsMatch(ctx, fromOld ? priorCandidate : candidate);
  await show(ctx, 'theme');
  await edition(ctx, 'light');
  if (experiment === 'named') {
    // Aim for an exact native-palette collision, not merely a similarly
    // colored saved work. The artifact itself is created with the Save UI.
    await liveToggle(ctx, false);
    await act(ctx, 'load-default').click();
    await saveAs(ctx, 'V03B Same Color');
    await liveToggle(ctx, true);
    const saved = namedWorks(ctx), id = 'theme-studio-v03b-same-color-light';
    assert.equal(Object.keys(saved).length, 2);
    await nativeTheme(page, 'light', id);
    await reopenQuiet(ctx);
    const before = await snapshot(ctx);
    const diffFromStock = paintDiff(before.root, expectedPaint(defaults('light')));
    assert.deepEqual(diffFromStock, [], 'named theme intentionally uses same representative paint as stock');
    assert.equal((await selected(page)).id, id);
    await show(ctx, 'theme');
    const w = watchThemes(ctx);
    const target = 'afterglow';
    try {
      assert.equal(await variant(ctx, 'light').getAttribute('aria-pressed'), 'true');
      await act(ctx, 'load-preset', target).click();
      await eventually(async () => (await sample(ctx)).background === curated(target, 'light').colors.surface.background, 'named-case draft updates');
      await delay(13_150);
      const after = await snapshot(ctx), afterStatus = await stateLine(ctx);
      const firstFsEvents = [...w.changes];
      await ctx.shot('named-same-palette-after-click');
      ctx.record('same-palette-named-theme-after-first-click', { nativeSelection: await selected(page),
        diffFromStock, completeHistoricalDiffFromStock: mismatches(stock.historical, before.historical),
        firstFsEvents, before: before.files, after: after.files, beforeWindow: before.summary, afterWindow: after.summary,
        trialObservationMs: 13_150, editor: await sample(ctx), state: afterStatus });
      assert.deepEqual(after.root.values, before.root.values, 'same-color named theme must not switch on a different card');
      assert.deepEqual(namedWorks(ctx), saved, 'named byte hashes and mtimes');
      // May probe a borrowed slot once, then roll it back. Reopen and wait a
      // full additional window: a retry on opening must never occur.
      await reopenQuiet(ctx, false, 13_150);
      await ctx.shot('named-same-palette-reopened');
      const again = w.changes.slice(firstFsEvents.length);
      assert.deepEqual(again, [], 'same-color case should not repeatedly write across reopen');
      assert.deepEqual(namedWorks(ctx), saved);
      assert.equal((await selected(page)).id, id);
      ctx.record('same-palette-named-theme-reopen', { fsEvents: again, named: namedWorks(ctx),
        state: await stateLine(ctx), slot: themeSummary(ctx, 'light') });
    } finally { w.stop(); }
    return;
  }
  await pick(ctx, 'tidemark', 'light', `${fromOld ? 'old rc03' : build} clean stock → Tidemark light`);
  if (fromOld) await saveAs(ctx, 'V03B Guard Pair');
  await oneRestore(ctx, stock, fromOld ? 'old-restore-exact-stock' : `${build}-first-restore-exact-stock`);
  if (!fromOld) {
    await edition(ctx, 'dark');
    await pick(ctx, 'afterglow', 'dark', 'only one curated click after first restore → dark Afterglow in real light window');
    await ctx.shot('after-restore-opposite-edition');
    await oneRestore(ctx, stock, `${build}-second-restore-exact-stock`);
    await ctx.shot('second-restore-native');
    return;
  }

  assert.equal(themeSummary(ctx, 'light').metadata.id, ownId);
  assert.equal(Object.keys(namedWorks(ctx)).length, 2);
  const chosen = experiment === 'old-slot' ? ownId : nativeId;
  await nativeTheme(page, 'light', chosen);
  // Deliberately set the edition on the old, blocked pane so that there is
  // only one card click after upgrading; no after-upgrade preparatory click
  // changes its profile or initiates a probe.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await mount(ctx);
  await show(ctx, 'theme');
  const oldSettledFiles = snapFiles(ctx);
  await edition(ctx, 'dark');
  await eventually(async () => (await stateLine(ctx)).text === 'Panel preview only', 'old candidate reports only panel');
  await delay(780);
  assert.deepEqual(snapFiles(ctx), oldSettledFiles);
  assert.equal((await selected(page)).id, chosen);
  const origin = await assertNativeColors(ctx, stock, 'old-same-color-actual-native-selection');
  const oldSlot = origin.slot;
  assert.deepEqual(origin.root.values, stock.root.values, 'old default and retired slot intentionally indistinguishable by native paint');
  const named = namedWorks(ctx);
  await ctx.shot('old-same-color-state');
  ctx.record('old-real-selection', { chosen, oldSlot, named, draftIsDark: true, state: await stateLine(ctx) });
  replaceFixtureExtension(ctx, priorCandidate);
  const opened = await reopenQuiet(ctx, true);
  assert.ok(sameBytes(opened.slot, oldSlot));
  assert.equal(await variant(ctx, 'dark').getAttribute('aria-pressed'), 'true', 'old draft edition survived replacing files');
  await ctx.shot('replacement-opening-read-only');
  const w = watchThemes(ctx);
  try {
    const click = performance.now();
    const applied = await pick(ctx, 'hojicha', 'dark', `${chosen}: one RC03b click → dark Hojicha in actual light window`);
    const untilProbeSettled = Math.max(0, 13_450 - (performance.now() - click));
    await delay(untilProbeSettled);
    const settled = await snapshot(ctx);
    const pickedSlice = [...w.changes];
    const nativeWhilePreview = await selected(page);
    ctx.record('one-selection-and-full-probe-window', { observedMs: Math.round(performance.now() - click), pickedSlice, chosen,
      nativeWhilePreview, slot: settled.slot, firstActualPaintMs: applied.data.latencyMs, window: settled.summary,
      state: await stateLine(ctx), namedAfter: namedWorks(ctx) });
    assert.ok(painted(settled.root, expectedPaint(curated('hojicha', 'dark'), 'light')));
    assert.deepEqual(namedWorks(ctx), named);
    await ctx.shot('one-click-settled');
    const refreshed = await reopenQuiet(ctx, true);
    assert.ok(painted(refreshed.root, expectedPaint(curated('hojicha', 'dark'), 'light')), 'published palette retained across renderer refresh');
    await oneRestore(ctx, origin, 'one-restore-after-in-place-replacement', true);
    const ended = await reopenQuiet(ctx, true);
    assert.ok(sameBytes(ended.slot, oldSlot));
    assert.equal(ended.slot.metadata.id, ownId);
    assert.equal((await selected(page)).id, chosen);
    assert.deepEqual(ended.historical, stock.historical);
    assert.deepEqual(namedWorks(ctx), named);
    assert.deepEqual(registry(ctx), origin.registry);
    ctx.record('original-native-identity-and-files-unchanged', { selected: chosen, oldSlot, afterSlot: ended.slot,
      historicalCount: Object.keys(ended.historical).length, originalNamed: named, finalNamed: namedWorks(ctx),
      oldPackageAfter: assertPackage('rc03'), noReinstall: identical(registry(ctx), origin.registry), pulseEvents: w.changes });
    await ctx.shot('restored-old-slot-exact-bytes');
  } finally { w.stop(); }
});
