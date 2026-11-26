// Deliberate remove/reinstall of the frozen rc03b in the two native hosts.
// Uses each clean-run native baseline and the same installation/isolated files.
import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, closeSettings, curated, evidence, eventually, expectPaint,
  file, historicalSurface, identical, language, liveToggle, load, mount, nativeTheme, paintSummary, rootPaint,
  run, saveAs, settings, show, slotFile, snapFiles, stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance, kind, resuming] = process.argv.slice(2);
assert.ok((kind === 'orphan' && ['v03b-wfresh', 'v03b-wrescue'].includes(instance)) || (kind === 'clean' && instance === 'v03b-dfresh'));
assert.ok(!resuming || resuming === 'resume-orphan' && kind === 'orphan' && instance === 'v03b-wrescue');
const namedWorks = ctx => Object.fromEntries(Object.entries(snapFiles(ctx)).filter(([n]) => !/^theme-studio-live-(?:light|dark)\.json$/u.test(n)));
const storagePath = ctx => join(ctx.state.openchamberData, 'guest-storage/theme-studio.json');
const stopSnapshot = ctx => ({ themes: snapFiles(ctx), storage: file(storagePath(ctx)), light: themeSummary(ctx, 'light'), dark: themeSummary(ctx, 'dark') });
const cleanBaseline = (name = instance) => {
  const previous = load(join(evidence, `${name}-clean.json`));
  assert.ok(previous.ok);
  assert.equal(previous.candidateProfile, 'rc03b');
  return previous.steps.find(s => s.stage === 'stock-before-install').snapshot;
};
async function removeGuest(page) {
  await settings(page, 'extensions');
  await button(page, /Theme Studio Folder · v0\.3\.0/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const close = button(page, /^(Close settings|关闭设置)$/u);
  if (await close.isVisible()) await closeSettings(page);
  await page.locator('iframe[title="Theme Studio"]').waitFor({ state: 'hidden' });
}
async function waitOriginal(ctx, stock) {
  const result = await eventually(async () => {
    const current = await rootPaint(ctx.page), history = await historicalSurface(ctx.page);
    return current.mode === stock.root.mode && identical(current.values, stock.root.values) &&
      identical(history, stock.historical) && current;
  }, 'actual stock 191 historical and all generated declarations', 17_000);
  return paintSummary(result);
}
async function badNews(ctx) {
  const state = await stateLine(ctx);
  assert.equal(await ctx.frame.locator('.studio-header [data-act=retry]').count(), 0);
  return state;
}
async function readHelp(ctx, loc) {
  const zh = loc === 'zh';
  const access = act(ctx, 'recovery-guide');
  await access.waitFor();
  assert.equal((await access.innerText()).trim(), zh ? '恢复方法' : 'Recovery steps');
  const banner = (await ctx.frame.locator('.u-banner').allTextContents()).join('\n').trim();
  assert.match(banner, zh ? /没有覆盖/u : /theme was not overwritten/iu);
  const status = await badNews(ctx);
  assert.equal(status.text, zh ? '找不到预览备份' : 'Preview backup missing');
  const before = stopSnapshot(ctx), rootBefore = paintSummary(await rootPaint(ctx.page)), writes = [];
  const watcher = watch(ctx.themes, (event, name) => { if (name) writes.push([event, name]); });
  try {
    await access.click();
    const dialog = ctx.frame.getByRole('dialog', { name: zh ? '卸载后找回内置配色' : 'Recover built-in colors after uninstalling' });
    await dialog.waitFor();
    const copy = (await dialog.innerText()).trim();
    const must = zh ? [/设置 → 外观/u, /先选另一个内置/u, /只移除/u, /trying on/u, /不要删除/u, /命名的作品/u, /不能找回.*草稿或备份/u]
      : [/Settings → Appearance/u, /switch to another built-in first/iu, /remove only/iu, /trying on/u,
        /don’t delete anything/iu, /keep your named/iu, /not drafts or backups/iu];
    for (const text of must) assert.match(copy, text);
    await ctx.shot(`${loc}-recovery-steps`);
    await ctx.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 3500 }).catch(async () => {
      const done = dialog.getByRole('button', { name: /^(Done|完成|关闭)$/u }).last();
      await done.click();
      await dialog.waitFor({ state: 'hidden' });
    });
    await delay(850);
    const after = stopSnapshot(ctx), rootAfter = paintSummary(await rootPaint(ctx.page));
    ctx.record('localized-recovery-help-no-write', { locale: loc, status, banner, guide: copy, before, after, writes, rootBefore, rootAfter });
    assert.deepEqual(after, before, 'help did not write theme files or guest storage');
    assert.deepEqual(writes, []);
    assert.deepEqual(rootBefore, rootAfter);
  } finally { watcher.close(); }
}

const recordId = kind === 'orphan' ? 'uninstall-orphan' : 'uninstall-clean';
await run(instance, resuming || recordId, async ctx => {
  const { page } = ctx;
  if (resuming) {
    const previous = load(join(evidence, `${instance}-${recordId}.json`));
    assert.deepEqual(previous.candidateBefore, ctx.report.candidateBefore);
    const captured = previous?.steps.find(s => s.stage === 'prior-draft-and-borrowed-theme');
    const stock = previous?.steps.find(s => s.stage === 'stock-before-uninstall-experiment')?.stock ?? cleanBaseline('v03b-wfresh');
    assert.ok(captured && stock);
    assert.equal(stock.summary.hash, captured.original.hash);
    const orphan = stopSnapshot(ctx);
    assert.equal(orphan.storage, null);
    assert.deepEqual(orphan.themes, captured.before.themes);
    const paintOrphan = await eventually(async () => {
      const root = await rootPaint(page);
      return paintSummary(root).hash === captured.remaining.hash && root;
    }, 'same persisted removed scene, native renderer received the still-borrowed colors after refresh');
    assert.equal(await page.locator('iframe[title="Theme Studio"]').count(), 0);
    await ctx.shot('native-removal-leaves-borrowed-colors');
    ctx.record('continued-same-isolated-uninstalled-scene', { orphan, paint: paintSummary(paintOrphan),
      beforeEvidence: `${instance}-${recordId}.json` });
    return await restoreAndFollowGuide(ctx, stock, orphan, paintOrphan, namedWorks(ctx));
  }
  let stock;
  if (instance === 'v03b-wrescue') {
    assert.deepEqual(snapFiles(ctx), {});
    await nativeTheme(page, 'light', 'openchamber-light');
    stock = await eventually(async () => {
      const root = await rootPaint(page), historical = await historicalSurface(page);
      return root.values['--surface-background'] === '#fdfcfa' && Object.keys(historical).length === 191
        && { root, historical, summary: paintSummary(root) };
    }, 'untouched native light on clean Web before uninstall test');
    await addFromSettings(ctx, '0.3.0');
  } else {
    stock = cleanBaseline();
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  ctx.record('stock-before-uninstall-experiment', { stock });
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await show(ctx, 'theme');
  const installed = await waitOriginal(ctx, stock);
  assert.equal(installed.count, Object.keys(stock.root.values).length);
  if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  await expectPaint(ctx, { label: 'borrow native Light via actual Tidemark click', trigger: () => act(ctx, 'load-preset', 'tidemark').click(),
    def: curated('tidemark', 'light'), mode: 'light', edit: 'light' });
  await saveAs(ctx, 'V03B Rescue Keep');
  const saved = namedWorks(ctx);
  assert.equal(Object.keys(saved).length, 2);
  if (kind === 'clean') {
    await act(ctx, 'restore').click();
    const before = await waitOriginal(ctx, stock);
    const files = stopSnapshot(ctx);
    assert.equal(files.light.metadata.id, 'theme-studio-live-light', 'neutral own slot no longer borrows a native ID');
    await ctx.shot('before-native-uninstall-stock');
    await removeGuest(page);
    const after = await waitOriginal(ctx, stock);
    const disk = stopSnapshot(ctx);
    assert.deepEqual(disk.themes, files.themes);
    assert.equal(disk.storage, null);
    assert.deepEqual(namedWorks(ctx), saved);
    assert.equal(await page.locator('iframe[title="Theme Studio"]').count(), 0);
    await ctx.shot('normal-uninstall-native-colors');
    ctx.record('normal-restore-before-native-uninstall', { before, after, historicalCount: Object.keys(stock.historical).length,
      files, disk, saved });
    return;
  }

  // A different, unsaved editor draft makes it possible to distinguish
  // a newly reconstructed orphan palette from actually recovering the draft.
  await liveToggle(ctx, false);
  await act(ctx, 'load-preset', 'blue-etch').click();
  await eventually(() => load(storagePath(ctx))?.['studio:v1:draft']?.value?.project?.origin?.ref === 'blue-etch',
    'stored independent unsaved draft');
  const before = stopSnapshot(ctx), paintBefore = await rootPaint(page);
  assert.equal(before.light.metadata.id, 'openchamber-light');
  assert.ok(load(storagePath(ctx))?.['studio:v1:preview-original-light']);
  await ctx.shot('different-unsaved-draft-before-remove');
  ctx.record('prior-draft-and-borrowed-theme', { before, original: stock.summary, remaining: paintSummary(paintBefore) });
  await removeGuest(page);
  const orphan = stopSnapshot(ctx);
  const paintOrphan = await eventually(async () => {
    const root = await rootPaint(page);
    return identical(root.values, paintBefore.values) && root;
  }, 'boot after native uninstall retains the actual borrowed paint');
  assert.equal(orphan.storage, null);
  assert.deepEqual(orphan.themes, before.themes);
  assert.deepEqual(paintOrphan.values, paintBefore.values);
  assert.equal(await page.locator('iframe[title="Theme Studio"]').count(), 0);
  await ctx.shot('native-removal-leaves-borrowed-colors');
  ctx.record('native-uninstall-removes-guest-data-not-borrowed-theme', { before, orphan, named: saved,
    original: stock.summary, remaining: paintSummary(paintOrphan) });
  await restoreAndFollowGuide(ctx, stock, orphan, paintOrphan, saved);
});

async function restoreAndFollowGuide(ctx, stock, orphan, paintOrphan, saved) {
  const { page } = ctx;
  await addFromSettings(ctx, '0.3.0');
  const offset = ctx.assets.length;
  await mount(ctx);
  await assetsMatch(ctx, candidate, offset);
  const readOnly = stopSnapshot(ctx);
  assert.deepEqual(readOnly, orphan);
  await act(ctx, 'restore').click();
  const access = act(ctx, 'recovery-guide');
  await access.waitFor();
  const after = stopSnapshot(ctx);
  assert.deepEqual(after.themes, orphan.themes);
  assert.deepEqual((await rootPaint(page)).values, paintOrphan.values);
  assert.deepEqual(namedWorks(ctx), saved);
  await ctx.shot('new-status-not-retry');
  ctx.record('reinstall-restore-safely-declines-without-backup', { status: await badNews(ctx), before: orphan, after,
    historicalChangedCount: Object.entries(await historicalSurface(page)).filter(([k, v]) => stock.historical[k] !== v).length });
  await readHelp(ctx, 'en');
  await language(ctx, 'zh');
  await readHelp(ctx, 'zh');
  await language(ctx, 'en');
  assert.deepEqual(snapFiles(ctx), orphan.themes);

  // Follow the real guide, selecting a different built-in first and then
  // removing only the precisely identified orphan preview.
  await nativeTheme(page, 'light', 'flexoki-light');
  const chosen = paintSummary(await rootPaint(page));
  assert.notEqual(chosen.hash, paintSummary(paintOrphan).hash);
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: 'Themes', exact: true }), 'Light').click();
  const row = page.getByRole('listbox', { name: 'Light theme', exact: true }).locator('[role=option][data-theme-id="openchamber-light"]');
  const exactRow = (await row.innerText()).trim();
  assert.match(exactRow, /^Theme Studio · [\s\S]+ \(trying on\)$/u);
  assert.equal(themeSummary(ctx, 'light').sha256, orphan.light.sha256);
  assert.equal(themeSummary(ctx, 'light').metadata.author, 'Theme Studio');
  await button(row, /delete|remove/iu).click();
  await eventually(() => file(slotFile(ctx, 'light')) === null, 'native Appearance removed the exact borrowed preview file');
  await closeSettings(page);
  await nativeTheme(page, 'light', 'openchamber-light');
  const returnedNative = await waitOriginal(ctx, stock);
  await ctx.shot('guided-native-recovery-restores-stock');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.deepEqual(await waitOriginal(ctx, stock), returnedNative);
  assert.deepEqual(namedWorks(ctx), saved);
  ctx.record('guide-operationally-recovers-native-not-draft', { exactRow, alternative: chosen, recovered: returnedNative,
    original: stock.summary, historicalCount: Object.keys(stock.historical).length, namedPreserved: namedWorks(ctx),
    finalDisk: stopSnapshot(ctx), recoveredOriginalDraft: false });
}
