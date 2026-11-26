// Targeted counterexample: produce the orphan using the real zh editor,
// then read the requested marker and the actual native Appearance row after
// a same-package reinstall. No theme writes outside genuine UI actions.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, closeSettings, curated, eventually, expectPaint,
  file, historicalSurface, identical, language, mount, nativeMode, nativeTheme, paintSummary, rootPaint,
  run, saveAs, settings, show, slotFile, snapFiles, stateLine, themeSummary,
} from './v-verify-0.3-fixture.mjs';

const [fixture] = process.argv.slice(2);
assert.equal(fixture, 'v03c-wzhrescue');
const markers = /Theme Studio · [\s\S]+ \(trying on\)$/u;
const studio = ctx => themeSummary(ctx, 'light');
const named = ctx => Object.fromEntries(Object.entries(snapFiles(ctx)).filter(([k]) => !/^theme-studio-live-/u.test(k)));
const storage = ctx => file(join(ctx.state.openchamberData, 'guest-storage/theme-studio.json'));
await run(fixture, 'localized-orphan-label', async ctx => {
  const { page } = ctx;
  assert.equal(ctx.report.candidateProfile, 'rc03c');
  assert.deepEqual(snapFiles(ctx), {});
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  const stock = await rootPaint(page), history = await historicalSurface(page);
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await saveAs(ctx, 'V03C Uninstall Safe Pair');
  const kept = named(ctx);
  assert.equal(Object.keys(kept).length, 2);

  await language(ctx, 'zh');
  await show(ctx, 'theme');
  await expectPaint(ctx, { label: '在中文工坊点击澄潮浅色', mode: 'light', edit: 'light', def: curated('tidemark', 'light'),
    trigger: () => act(ctx, 'load-preset', 'tidemark').click() });
  const before = snapFiles(ctx), preview = studio(ctx), actual = await rootPaint(page);
  assert.equal(preview.metadata.id, 'openchamber-light');
  assert.match(preview.metadata.name, /（试穿）$/u);
  await ctx.shot('chinese-preview-is-live-before-uninstall');
  ctx.record('orphan-was-generated-in-zh', { locale: await ctx.frame.locator('.studio').getAttribute('data-locale'), preview,
    previewPaint: paintSummary(actual), originalPaint: paintSummary(stock), named: kept });
  // The Chrome Playwright fixture can manipulate the native Extensions
  // selector in English, but verify the already-written name is NOT changed
  // by this UI-only locale choice. Then show the guide in Chinese as a user.
  await language(ctx, 'en');
  assert.deepEqual(snapFiles(ctx), before);
  await settings(page, 'extensions');
  await button(page, /Theme Studio Folder · v0\.3\.0/u).click();
  await button(page, 'Remove Theme Studio').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const navClose = button(page, /^(Close settings|关闭设置)$/u);
  if (await navClose.isVisible()) await closeSettings(page);
  await eventually(async () => {
    const now = await rootPaint(page);
    return identical(now.values, actual.values) && now;
  }, 'same actual orphan window after reload');
  assert.equal(storage(ctx), null);
  assert.deepEqual(snapFiles(ctx), before);
  const receivedFrom = ctx.assets.length;
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate, receivedFrom);
  assert.deepEqual(snapFiles(ctx), before);
  await language(ctx, 'zh');
  await act(ctx, 'restore').click();
  const recovery = act(ctx, 'recovery-guide');
  await recovery.waitFor();
  assert.equal((await stateLine(ctx)).text, '找不到预览备份');
  await recovery.click();
  const dialog = ctx.frame.getByRole('dialog', { name: '卸载后找回内置配色' });
  const copy = (await dialog.innerText()).trim();
  await ctx.shot('zh-guide-asks-for-english-only-marker');
  assert.deepEqual(snapFiles(ctx), before);
  await button(dialog, '完成').click();
  await language(ctx, 'en');
  const flexoki = await nativeTheme(page, 'light', 'flexoki-light');
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: 'Themes', exact: true }), 'Light').click();
  const list = page.getByRole('listbox', { name: 'Light theme', exact: true });
  const row = list.locator('[role=option][data-theme-id="openchamber-light"]');
  const realName = (await row.innerText()).trim();
  const canDeleteOnlyAfterVerifying = await button(row, /delete|remove/iu).isVisible();
  await row.hover(); // reveal the actual accessible row in the screenshot
  await ctx.shot('appearance-actual-chinese-preview-label');
  const entries = await list.getByRole('option').allInnerTexts();
  const englishMarkerFound = entries.some(k => markers.test(k.trim()));
  const matched = copy.includes('(trying on)') && !copy.includes('（试穿）') && !englishMarkerFound &&
    realName === preview.metadata.name && /找不到这条标记就不要删除/u.test(copy);
  ctx.record('guide-marker-mismatch', { copy, actualRowLabel: realName, rowId: await row.getAttribute('data-theme-id'),
    englishMarkerFound, canDeleteOnlyAfterVerifying, mismatched: matched, switchedTo: flexoki,
    themesUnchangedThroughHelp: identical(snapFiles(ctx), before), afterGuidedFirstStep: paintSummary(await rootPaint(page)) });
  assert.equal(matched, true, 'test is expected to capture or refute the frozen candidate wording mismatch');

  // Bound the problem: a user following the actual text must stop, but a
  // verified fixture operator can safely identify the row by the known
  // localized suffix and the exact leaked name/ID. Only do that on this
  // isolated reproduction, and leave the two named works untouched.
  assert.ok(canDeleteOnlyAfterVerifying && studio(ctx).sha256 === preview.sha256);
  await button(row, /delete|remove/iu).click();
  await eventually(() => file(slotFile(ctx, 'light')) === null, 'native removal targeted at known same SHA localized preview only');
  await closeSettings(page);
  await nativeTheme(page, 'light', 'openchamber-light');
  const back = await eventually(async () => {
    const val = await rootPaint(page);
    return identical(stock.values, val.values) && val;
  }, 'safe fallback after correctly recognizing the actual localized entry');
  await delay(150);
  assert.deepEqual(await historicalSurface(page), history);
  assert.deepEqual(named(ctx), kept);
  await ctx.shot('native-colors-recovered-with-correct-identity');
  ctx.record('manual-safety-bounded-recovery', { actualRowWas: realName, historicalCount: Object.keys(history).length,
    paint: paintSummary(back), namedUnchanged: named(ctx), matchToOriginal: true });
});
