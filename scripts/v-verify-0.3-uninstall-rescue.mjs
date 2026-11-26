// Native remove → reload → native add and approve the identical package →
// open without changing the draft → one footer Restore. Studio-owned test
// files are read for evidence; the native UI performs all theme actions.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, cap, closeSettings, curated, editions,
  eventually, evidence, expectPaint, file, historicalSurface, identical, liveToggle, load, mount,
  nativeMode, nativeTheme, paintSummary, rootPaint, run, sample, saveAs, settings, show, snapFiles,
  stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance, start] = process.argv.slice(2);
assert.ok((start === 'existing' && instance === 'v03-wremove') ||
  (start === 'fresh' && /^v03-[dw]rescue(?:-\w+)?$/u.test(instance)));
const footprint = names => Object.fromEntries(Object.entries(names).filter(([name]) => !/^theme-studio-live-(light|dark)\.json$/u.test(name)));
const diff = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  .filter(k => a[k] !== b[k]).map(k => [k, [a[k] ?? null, b[k] ?? null]]));
const readStorage = ctx => {
  const p = join(ctx.state.openchamberData, 'guest-storage/theme-studio.json');
  const d = load(p) ?? {};
  const entry = key => d[`studio:v1:${key}`]?.value;
  return {
    fingerprint: file(p),
    keys: Object.keys(d).sort().map(k => k.replace(/:(?:[a-z0-9-]{16,}):\d+$/iu, ':[pages]')),
    draft: { present: Boolean(d['studio:v1:draft']), origin: entry('draft')?.project?.origin ?? null,
      edit: entry('draft')?.editVariant ?? null },
    backups: Object.fromEntries(editions.map(v => [v, { present: entry(`preview-original-${v}`) != null ||
      Boolean(d[`studio:v1:preview-original-${v}`]?.pages), ownsPreviousBytes: typeof entry(`preview-original-${v}`)?.raw === 'string',
      originalFileAbsent: entry(`preview-original-${v}`)?.raw === null, writer: entry(`preview-original-${v}`)?.id ?? null }])),
  };
};
const slots = ctx => Object.fromEntries(editions.map(v => [v, themeSummary(ctx, v)]));
const modes = async page => {
  await settings(page, 'appearance');
  const out = {};
  for (const v of editions) {
    await button(page.getByRole('group', { name: 'Themes', exact: true }), cap(v)).click();
    const box = page.getByRole('listbox', { name: `${cap(v)} theme`, exact: true });
    const selected = box.locator('[role=option][aria-selected=true]');
    await selected.waitFor();
    const stock = box.locator(`[role=option][data-theme-id="openchamber-${v}"]`);
    out[v] = { selected: await selected.getAttribute('data-theme-id'), label: (await selected.innerText()).trim(),
      stockLabel: (await stock.innerText()).trim(), stockRowHasDelete: await button(stock, /delete|remove/iu).count() > 0 };
  }
  await closeSettings(page);
  return out;
};
async function editor(ctx) {
  const edit = await variant(ctx, 'light').getAttribute('aria-pressed') === 'true' ? 'light' : 'dark';
  return { edit, sample: await sample(ctx),
  chosen: await ctx.frame.locator('.theme-page [aria-pressed=true][data-act]').evaluateAll(els =>
    els.map(el => [el.dataset.act, el.dataset.id ?? null])), status: await stateLine(ctx) };
}
async function surface(page) {
  const r = await rootPaint(page), historical = await historicalSurface(page);
  return { summary: paintSummary(r), generated: r.values, historical };
}
async function removeFromSettings(page) {
  await settings(page, 'extensions');
  await button(page, /Theme Studio Folder · v0\.3\.0/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeSettings(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('iframe[title="Theme Studio"]').waitFor({ state: 'hidden' });
}

await run(instance, 'uninstall-rescue', async ctx => {
  const { page } = ctx;
  const stock = {}, screens = {};
  let preRemove = null, initialFiles;
  if (start === 'existing') {
    // Compare to the prior pre-uninstall run's measured full stock hash.
    // That older report didn't serialize its historical surface, so reuse
    // the independently measured same-version Web native preinstall values
    // only after checking the unchanged full-palette native hash.
    const previous = load(join(evidence, 'v03-wremove-remove.json')).steps.find(s => s.stage === 'native-uninstall');
    const earlier = load(join(evidence, 'v03-wupalt-alt-upgrade2.json')).steps.find(s => s.stage === 'before-install');
    assert.equal(earlier.summary.hash, previous.original.hash);
    stock.light = { summary: earlier.summary, generated: earlier.root.values, historical: earlier.historical };
    initialFiles = snapFiles(ctx);
    assert.deepEqual(Object.keys(initialFiles), ['theme-studio-live-light.json']);
    const light = slots(ctx).light;
    assert.deepEqual({ sha256: light.sha256, mtimeNs: light.mtimeNs, size: light.size },
      { sha256: previous.slotAfter.sha256, mtimeNs: previous.slotAfter.mtimeNs, size: previous.slotAfter.size },
      'reuse the exact stopped Web uninstall filesystem, not regenerated preview');
    await eventually(async () => (await surface(page)).summary.hash === previous.after.hash, 'restarted Web matches old uninstall palette');
    ctx.record('reused-web-uninstalled-scene', { sameSlotBytesAndMtime: true, earlierNativeHash: previous.original.hash,
      isolatedFixtureRestarted: true, independentHistoricalReference: 'v03-wupalt-alt-upgrade2.json' });
  } else {
    assert.deepEqual(snapFiles(ctx), {});
    const originalSelections = {};
    for (const v of [...editions].reverse()) {
      await nativeMode(page, v, v);
      originalSelections[v] = await nativeTheme(page, v, `openchamber-${v}`);
      stock[v] = await surface(page);
    }
    ctx.record('native-baseline', { stock, originalSelections });
    await addFromSettings(ctx, '0.3.0');
    await mount(ctx);
    await assetsMatch(ctx, candidate);
    await show(ctx, 'theme');
    if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
    await expectPaint(ctx, { label: 'prepare actually borrowed light', mode: 'light', edit: 'light', def: curated('tidemark', 'light'),
      trigger: () => act(ctx, 'load-preset', 'tidemark').click() });
    await saveAs(ctx, 'V03 Refuge Pair', 'both');
    await nativeMode(page, 'dark', 'dark');
    await mount(ctx);
    if (await variant(ctx, 'dark').getAttribute('aria-pressed') !== 'true') {
      await variant(ctx, 'dark').click();
      await eventually(async () => slots(ctx).dark?.variant === 'dark', 'crossing toggle actually painted dark');
      await delay(2450);
    }
    await expectPaint(ctx, { label: 'prepare actually borrowed dark', mode: 'dark', edit: 'dark', def: curated('hojicha', 'dark'),
      trigger: () => act(ctx, 'load-preset', 'hojicha').click() });
    await nativeMode(page, 'light', 'light');
    await mount(ctx);
    await liveToggle(ctx, false);
    if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
    await act(ctx, 'load-preset', 'blue-etch').click();
    await eventually(() => readStorage(ctx).draft.origin?.ref === 'blue-etch', 'distinct unsaved Blue Etch was persisted');
    await eventually(async () => (await sample(ctx)).background === curated('blue-etch', 'light').colors.surface.background,
      'unsaved Blue Etch visible in panel only');
    initialFiles = snapFiles(ctx);
    assert.equal(Object.keys(footprint(initialFiles)).length, 2);
    preRemove = { window: await surface(page), slots: slots(ctx), named: footprint(initialFiles), editor: await editor(ctx),
      storage: readStorage(ctx), selections: await modes(page) };
    assert.equal(preRemove.window.summary.canvas, curated('tidemark', 'light').colors.surface.background);
    assert.ok(editions.every(v => preRemove.slots[v].metadata.id === `openchamber-${v}` && preRemove.storage.backups[v].present));
    screens.before = await ctx.shot('before-remove-distinct-draft');
    ctx.record('before-uninstall', preRemove);
    await removeFromSettings(page);
    await eventually(async () => (await surface(page)).summary.hash === preRemove.window.summary.hash, 'uninstalled window still Tidemark');
  }
  const removed = { window: await surface(page), storage: readStorage(ctx), slots: slots(ctx), files: snapFiles(ctx),
    selections: await modes(page) };
  assert.deepEqual(removed.files, initialFiles);
  assert.equal(removed.storage.fingerprint, null);
  assert.equal(await page.locator('iframe[title="Theme Studio"]').count(), 0);
  screens.removed = await ctx.shot('removed-and-reloaded');
  ctx.record('direct-uninstall-still-borrowed', removed);

  await addFromSettings(ctx, '0.3.0');
  const beforeOpen = { themes: snapFiles(ctx), persistence: readStorage(ctx),
    registration: file(join(ctx.state.openchamberData, 'extensions.json')) };
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await delay(3200);
  const afterOpen = { themes: snapFiles(ctx), persistence: readStorage(ctx),
    registration: file(join(ctx.state.openchamberData, 'extensions.json')), window: await surface(page), draft: await editor(ctx) };
  assert.deepEqual(afterOpen.themes, beforeOpen.themes);
  assert.deepEqual(afterOpen.registration, beforeOpen.registration);
  assert.deepEqual(afterOpen.window.generated, removed.window.generated);
  screens.reopened = await ctx.shot('readded-open-no-theme-write');
  ctx.record('same-package-reinstalled-passive', { beforeOpen, afterOpen, honoredUnsavedDraft: preRemove ?
    identical(preRemove.editor.sample, afterOpen.draft.sample) : null });

  // No Studio recipe, variant, or theme click intervenes between mount and
  // this action. Only passively observe the reinstalled editor first.
  const restore = act(ctx, 'restore');
  const dispatched = await restore.isEnabled();
  if (dispatched) await restore.click();
  await delay(4300);
  const observedRestore = { dispatched, window: await surface(page), files: snapFiles(ctx), slots: slots(ctx),
    storage: readStorage(ctx), editor: await editor(ctx),
    messages: await ctx.frame.locator('.u-banner,.studio-toast:not([hidden])').allTextContents() };
  screens.restore = await ctx.shot('restore-only');
  const nativeAfter = { light: observedRestore.window };
  if (stock.dark) {
    await nativeMode(page, 'dark', 'dark');
    nativeAfter.dark = await surface(page);
    await nativeMode(page, 'light', 'light');
  }
  const difference = Object.fromEntries(Object.keys(stock).map(v => [v, {
    historicalCount: Object.keys(stock[v].historical).length,
    generatedCount: Object.keys(stock[v].generated).length,
    historical: diff(stock[v].historical, nativeAfter[v].historical),
    generated: diff(stock[v].generated, nativeAfter[v].generated),
  }]));
  const matchedStock = Object.values(difference).every(v => !Object.keys(v.historical).length && !Object.keys(v.generated).length);
  const namedUnchanged = identical(footprint(initialFiles), footprint(snapFiles(ctx)));
  assert.ok(namedUnchanged, 'named works cannot be altered by uninstall/reinstall/Restore');
  ctx.record('reinstall-restore-outcome', { observedRestore, nativeAfter, difference, matchedStock, namedUnchanged,
    originalEditorRecovered: preRemove ? identical(observedRestore.editor.sample, preRemove.editor.sample) : null,
    slotFileIds: Object.fromEntries(editions.map(v => [v, observedRestore.slots[v]?.metadata.id ?? null])),
    nativeSelection: await modes(page), screens });

  if (matchedStock) return;
  // Native fallback: check what the Appearance picker allows, and prefer
  // its own delete of only an exact verified preview file after switching
  // away. Never touch any named works, nor simulate a native file action.
  const recovery = {};
  for (const v of Object.keys(stock)) {
    await nativeMode(page, v, v);
    const matchingSlot = slots(ctx)[v];
    if (matchingSlot?.metadata.id !== `openchamber-${v}`) continue;
    const alternate = `flexoki-${v}`;
    const chosen = await nativeTheme(page, v, alternate);
    const safer = await surface(page);
    assert.notEqual(safer.summary.hash, removed.window.summary.hash);
    await settings(page, 'appearance');
    await button(page.getByRole('group', { name: 'Themes', exact: true }), cap(v)).click();
    const row = page.getByRole('listbox', { name: `${cap(v)} theme`, exact: true })
      .locator(`[role=option][data-theme-id="openchamber-${v}"]`);
    const del = button(row, /delete|remove/iu);
    const deletable = await del.isVisible();
    const rowLabel = (await row.innerText()).trim();
    let exactNative = null;
    if (deletable) {
      assert.ok(matchingSlot.variant && matchingSlot.metadata.author === 'Theme Studio', 'only fixture-owned borrowed slot');
      assert.match(rowLabel, /Theme Studio/u);
      await del.click();
      await eventually(() => !slots(ctx)[v], 'only fixture preview slot removed through native settings', 5_000);
      await closeSettings(page);
      await nativeTheme(page, v, `openchamber-${v}`);
      exactNative = await eventually(async () => {
        const r = await surface(page); return r.summary.hash === stock[v].summary.hash && r;
      }, 'really native full palette after native delete', 8_000);
    } else {
      await closeSettings(page);
      await nativeTheme(page, v, `openchamber-${v}`);
      await delay(500);
      const reselect = await surface(page);
      recovery[`${v}ReselectOriginal`] = { window: reselect.summary, matchesStock: reselect.summary.hash === stock[v].summary.hash };
      await nativeTheme(page, v, alternate);
    }
    recovery[v] = { chosen, safer: safer.summary, rowLabel, hasNativeDelete: deletable,
      exactNative: exactNative?.summary ?? null, nativeHistoricalMatch: exactNative ? identical(exactNative.historical, stock[v].historical) : null,
      screenshot: await ctx.shot(`native-fallback-${v}`) };
  }
  assert.deepEqual(footprint(snapFiles(ctx)), footprint(initialFiles));
  ctx.record('safe-native-recovery', { recovery, finalSlots: slots(ctx), namedPreserved: footprint(snapFiles(ctx)) });
});
