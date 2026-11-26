// Native black-box checks against the single frozen D folder. English and
// Chinese help are examined against the same actual Chinese-origin orphan.
// Only the real Appearance UI can remove it and only after verifying identity.
import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, builtin, button, candidate, closeSettings, curated,
  eventually, expectPaint, expectedPaint, file, historicalSurface, identical, language, load, mount,
  nativeMode, nativeTheme, painted, paintSummary, restore, rootPaint, run, saveAs, settings,
  show, slotFile, snapFiles, stateLine, themeSummary, variant,
} from './v-verify-0.3-fixture.mjs';

const [fixture, kind] = process.argv.slice(2);
assert.ok(/^v03d-v-(?:dcross|wrescue)(?:-[a-z0-9]{1,3})?$/u.test(fixture ?? ''));
assert.equal(kind, fixture.includes('-wrescue') ? 'localized-recovery' : 'cross-mode');
const builtinId = 'openchamber-light';
const nativeSlot = 'theme-studio-live-light.json';
const named = ctx => Object.fromEntries(Object.entries(snapFiles(ctx)).filter(([key]) => !/^theme-studio-live-/u.test(key)));
const inAppLocale = ctx => ctx.frame.locator('.studio').getAttribute('data-locale');
const storagePath = ctx => join(ctx.state.openchamberData, 'guest-storage/theme-studio.json');
const storage = ctx => file(storagePath(ctx));
const nativeMarker = /^Theme Studio · \S[\s\S]*（试穿）$/u;

function observeThemes(ctx) {
  const events = [];
  const watcher = watch(ctx.themes, (event, name) => events.push({ event, name }));
  return { events, close: () => watcher.close() };
}
async function stockAgain(ctx, stock, label) {
  const result = await eventually(async () => {
    const root = await rootPaint(ctx.page), history = await historicalSurface(ctx.page);
    return root.mode === stock.mode && identical(history, stock.history) && identical(root.values, stock.values) && root;
  }, label, 20_000);
  return { ...paintSummary(result), historicalCount: Object.keys(stock.history).length };
}
async function appearance(ctx, locale) {
  const zh = locale === 'zh', { page } = ctx;
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: zh ? '主题' : 'Themes', exact: true }), zh ? '浅色' : 'Light').click();
  const list = page.getByRole('listbox', { name: zh ? '浅色主题' : 'Light theme', exact: true });
  await list.waitFor();
  return list;
}
async function previewSmoke(ctx, stock) {
  const kept = named(ctx), { page } = ctx;
  await show(ctx, 'theme');
  if (await variant(ctx, 'dark').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'dark').click();
  await eventually(async () => (await variant(ctx, 'dark').getAttribute('aria-pressed')) === 'true', 'dark edition selected');
  const change = await expectPaint(ctx, { label: 'D original light host → click dark Afterglow edition', mode: 'light', edit: 'dark',
    def: curated('afterglow', 'dark'), trigger: () => act(ctx, 'load-preset', 'afterglow').click(), timeout: 20_000 });
  assert.deepEqual(change.data.trusted.map(x => [x.act, x.id]), [['load-preset', 'afterglow']]);
  assert.equal(themeSummary(ctx, 'light').variant, 'dark');
  const before = await ctx.shot('clicked-dark-afterglow-in-light-window');
  const initialClicks = await ctx.frame.locator('body').evaluate(() => window.__v03RecordedClicks.length);
  await restore(ctx, stock, 'pre-install native palette');
  const events = await ctx.frame.locator('body').evaluate((_body, from) => window.__v03RecordedClicks.slice(from), initialClicks);
  assert.deepEqual(events.map(x => x.act), ['restore']);
  const proof = await stockAgain(ctx, stock, 'Tried cross-edition once, manual restore is exact');
  assert.equal(themeSummary(ctx, 'light').metadata.id, 'theme-studio-live-light');
  assert.deepEqual(named(ctx), kept);
  const after = await ctx.shot('one-restore-exact-native');
  ctx.record('active-cross-edition-and-one-restore', { realHostStayedLight: (await rootPaint(page)).mode === 'light',
    paint: paintSummary(change.done), click: change.data.trusted, restore: events, restored: proof,
    ownSlot: themeSummary(ctx, 'light'), namedUnchanged: kept, screenshots: [before, after] });
}
async function guide(ctx, loc, before, priorRoot) {
  const zh = loc === 'zh';
  const access = act(ctx, 'recovery-guide');
  await access.waitFor();
  const state = await stateLine(ctx);
  assert.equal(state.text, zh ? '找不到预览备份' : 'Preview backup missing');
  assert.equal((await access.innerText()).trim(), zh ? '恢复方法' : 'Recovery steps');
  assert.equal(await ctx.frame.locator('.studio-header [data-act=retry]').count(), 0);
  assert.equal(await inAppLocale(ctx), loc);
  // Restore itself can initialize a new draft after reinstall. The help
  // dialog should not change that newly created guest storage on its own.
  await delay(500);
  const beforeStorage = storage(ctx);
  await access.click();
  const dialog = ctx.frame.getByRole('dialog', { name: zh ? '卸载后找回内置配色' : 'Recover built-in colors after uninstalling' });
  await dialog.waitFor();
  const text = (await dialog.innerText()).trim();
  const instructions = zh
    ? [/设置 → 外观/u, /先选另一个内置主题/u, /只移除/u, /再选回原来的内置主题/u, /不能确认.*不要删除/u, /保留你命名的作品/u, /不能找回.*草稿或备份/u]
    : [/Settings → Appearance/u, /switch to another built-in/iu, /remove only/iu, /select the original built-in again/iu, /can’t identify.*don’t delete/iu, /keep your named themes/iu, /not drafts or backups/iu];
  const actualMarkers = [...text.matchAll(/“(Theme Studio · …(?:（试穿）| \(trying on\)))”/gu)].map(x => x[1]);
  const screenshot = await ctx.shot(`${loc}-guide-shows-both-preview-names`);
  ctx.record('read-localized-guide', { locale: loc, state, text, actualMarkers, screenshot });
  for (const phrase of instructions) assert.match(text, phrase);
  assert.equal(new Set(actualMarkers).size, 2, 'both real name templates in each rendered locale');
  await button(dialog, zh ? '完成' : 'Done').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(snapFiles(ctx), before);
  assert.deepEqual((await rootPaint(ctx.page)).values, priorRoot.values);
  assert.deepEqual(storage(ctx), beforeStorage, `only reading ${loc} help did not change the new guest storage`);
  return { loc, text, actualMarkers };
}

await run(fixture, kind, async ctx => {
  const { page } = ctx;
  assert.equal(ctx.report.candidateProfile, 'rc03d');
  assert.equal(ctx.report.host, kind === 'cross-mode' ? 'desktop' : 'web');
  assert.equal(ctx.report.webPackage, '2.8.0');
  assert.deepEqual(snapFiles(ctx), {});
  await nativeMode(page, 'light', kind === 'cross-mode' ? 'dark' : 'light');
  const originalTitle = await nativeTheme(page, 'light', builtinId);
  const stock = await eventually(async () => {
    const root = await rootPaint(page), history = await historicalSurface(page);
    return root.mode === 'light' && root.values['--surface-background'] === '#fdfcfa' &&
      Object.keys(history).length === 191 && Object.keys(root.values).length === 265 && { ...root, history };
  }, 'original native palette with 191 historical and 265 generated styles');
  ctx.record('native-stock-before-install', { originalTitle, root: stock, paint: paintSummary(stock) });
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  if (kind === 'cross-mode') {
    await previewSmoke(ctx, stock);
    return;
  }

  await saveAs(ctx, 'V03D Recovery Keep', 'both');
  const saved = named(ctx);
  assert.equal(Object.keys(saved).length, 2);
  await language(ctx, 'zh');
  await show(ctx, 'theme');
  assert.equal(await inAppLocale(ctx), 'zh');
  if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  const sourcePaint = await expectPaint(ctx, { label: 'D 中文编辑器主动点击浅色澄潮', mode: 'light', edit: 'light',
    def: curated('tidemark', 'light'), trigger: () => act(ctx, 'load-preset', 'tidemark').click() });
  const originalTrial = themeSummary(ctx, 'light'), trialFiles = snapFiles(ctx);
  assert.ok(originalTrial && storage(ctx));
  assert.equal(originalTrial.metadata.id, builtinId);
  assert.equal(originalTrial.metadata.name, 'Theme Studio · 澄潮（试穿）');
  assert.equal(originalTrial.metadata.author, 'Theme Studio');
  assert.deepEqual(named(ctx), saved);
  await ctx.shot('actual-pre-uninstall-chinese-trial');
  ctx.record('chinese-trial-was-actually-written-and-painted', { locale: 'zh', slot: originalTrial, named: saved,
    clicks: sourcePaint.data.trusted, trial: paintSummary(sourcePaint.done) });

  // The common native Extensions installer uses English accessible names.
  // This UI-only switch neither renames the stored trial nor writes its file.
  await language(ctx, 'en');
  assert.deepEqual(snapFiles(ctx), trialFiles);
  await settings(page, 'extensions');
  await button(page, /Theme Studio Folder · v0\.3\.0/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await button(page, 'Close settings').isVisible()) await closeSettings(page);
  await page.locator('iframe[title="Theme Studio"]').waitFor({ state: 'hidden' });
  const orphan = await eventually(async () => {
    const r = await rootPaint(page);
    return identical(r.values, sourcePaint.done.values) && r;
  }, 'uninstall and reload leave the same actual borrowed palette');
  assert.equal(storage(ctx), null);
  assert.deepEqual(snapFiles(ctx), trialFiles);
  ctx.record('native-uninstall-left-the-localized-orphan', { slot: originalTrial, named: named(ctx),
    palette: paintSummary(orphan), guestNamespacePresent: false });

  const offset = ctx.assets.length;
  const w = observeThemes(ctx);
  let reading;
  try {
    await addFromSettings(ctx, '0.3.0');
    await mount(ctx);
    await assetsMatch(ctx, candidate, offset);
    await delay(650);
    assert.deepEqual(snapFiles(ctx), trialFiles);
    await act(ctx, 'restore').click(); // only once, never “Retry”
    const en = await guide(ctx, 'en', trialFiles, orphan);
    await language(ctx, 'zh');
    const zh = await guide(ctx, 'zh', trialFiles, orphan);
    await delay(200);
    assert.deepEqual(w.events, [], 'reinstall/open, rejected restore and both help reads do not write any theme file');
    const recreatedKeys = Object.keys(load(storagePath(ctx)) ?? {}).sort();
    assert.ok(!recreatedKeys.some(key => key.includes('preview-original')), 'the original preview backup remains missing');
    reading = [en, zh];
    ctx.record('reinstall-restore-and-bilingual-help-no-theme-writes', { events: w.events, disk: snapFiles(ctx),
      palette: paintSummary(await rootPaint(page)), recreatedGuestStorageKeys: recreatedKeys, originalBackupRecovered: false });
  } finally { w.close(); }

  // Follow the visible help in native Chinese Settings. Use the labels from
  // the UI to find the only matching preview, not an API or an ID lookup to
  // bypass the text a user has. The verified ID/SHA are extra delete guards.
  let list = await appearance(ctx, 'zh');
  const lightAlternate = list.locator('[role=option][data-theme-id="flexoki-light"]');
  await lightAlternate.click();
  await eventually(async () => (await lightAlternate.getAttribute('aria-selected')) === 'true', 'really selected alternative Flexoki');
  await closeSettings(page);
  const substitute = await eventually(async () => {
    const now = await rootPaint(page); return painted(now, expectedPaint(builtin('flexoki', 'light'))) && now;
  }, 'alternative built-in actually displayed before any delete');
  assert.notEqual(paintSummary(substitute).hash, paintSummary(orphan).hash);
  const chosen = {};
  for (const info of reading) {
    if (await inAppLocale(ctx) !== info.loc) await language(ctx, info.loc);
    list = await appearance(ctx, info.loc);
    const template = info.actualMarkers.find(k => k.endsWith('（试穿）'));
    const [prefix, suffix] = template.split('…');
    const visible = (await list.getByRole('option').allInnerTexts()).map(s => s.trim()).filter(Boolean);
    const matches = visible.filter(t => t.startsWith(prefix) && t.endsWith(suffix));
    assert.deepEqual(matches, [originalTrial.metadata.name], 'both help languages locate one actual preview by visible name');
    const row = list.getByRole('option', { name: matches[0], exact: true });
    // Native option name may also include its nested delete button. Exact
    // visible label text is used when that accessible name is concatenated.
    const matchByLabel = await row.count() === 1 ? row : list.getByRole('option').filter({ has: page.getByText(matches[0], { exact: true }) });
    assert.equal(await matchByLabel.count(), 1);
    const id = await matchByLabel.getAttribute('data-theme-id');
    assert.equal(id, originalTrial.metadata.id);
    assert.equal(await matchByLabel.getAttribute('aria-selected'), 'false');
    assert.equal((await matchByLabel.innerText()).trim(), matches[0]);
    const deleteButton = button(matchByLabel, info.loc === 'zh' ? /^删除已导入的主题 /u : /delete|remove/iu);
    assert.ok(await deleteButton.isVisible());
    await matchByLabel.hover();
    const matchesShot = await ctx.shot(`${info.loc}-appearance-matches-chinese-preview`);
    chosen[info.loc] = { title: matches[0], id, exactlyOne: true, deleteButton: await deleteButton.getAttribute('aria-label'), matchesShot };
    assert.deepEqual(snapFiles(ctx), trialFiles);
    if (info.loc === 'en') await closeSettings(page);
  }
  ctx.record('both-guides-unambiguously-identify-real-native-row', { chosen, alternate: paintSummary(substitute),
    file: themeSummary(ctx, 'light'), onlyDeleteWhenIdentified: true });

  // The loop ends in Chinese Appearance with the unique name still verified.
  assert.equal(chosen.zh.title, chosen.en.title);
  assert.match(chosen.zh.title, nativeMarker);
  assert.deepEqual(themeSummary(ctx, 'light'), originalTrial);
  assert.deepEqual(named(ctx), saved);
  const licensedToDelete = list.getByRole('option').filter({ has: page.getByText(chosen.zh.title, { exact: true }) });
  assert.equal(await licensedToDelete.count(), 1);
  await button(licensedToDelete, `删除已导入的主题 ${chosen.zh.title}`).click();
  await eventually(() => file(slotFile(ctx, 'light')) === null, 'native deletion only for that identified preview');
  const trueStock = list.locator(`[role=option][data-theme-id="${builtinId}"]`);
  await eventually(async () => (await trueStock.innerText()).trim() === originalTitle, 'true built-in title is no longer shadowed');
  assert.equal(await trueStock.getByRole('button').count(), 0, 'built-in row is not deletable');
  await trueStock.click();
  await eventually(async () => (await trueStock.getAttribute('aria-selected')) === 'true', 'real built-in reselected');
  await closeSettings(page);
  const recovered = await stockAgain(ctx, stock, 'guide restores original built-in colors');
  const recoveryShot = await ctx.shot('guided-recovery-matches-native');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.deepEqual(await stockAgain(ctx, stock, 'guide also restores after a reload'), recovered);
  const remaining = snapFiles(ctx);
  assert.deepEqual(remaining, saved, 'only the verified preview slot was removed; both named works SHA and mtime unchanged');
  assert.equal(trialFiles[nativeSlot].sha256, originalTrial.sha256);
  ctx.record('guided-native-recovery-exact-no-named-write', { recovered, afterReload: true, original: paintSummary(stock),
    onlyDeleted: nativeSlot, namedBefore: saved, namedAfter: remaining, recoveryShot });

  // Same actual D package remains installed. One focused user action in the
  // other edition plus one Restore, not the earlier full matrix.
  await mount(ctx);
  await previewSmoke(ctx, stock);
});
