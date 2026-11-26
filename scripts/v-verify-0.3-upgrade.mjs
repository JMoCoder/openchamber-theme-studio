// Replay the reported 0.2.0 window state, then replace ONLY the fixture's
// staged source folder and reload the renderer. No reinstall/host API.
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, candidate, curated, defaults, eventually, expectPaint, file, identical,
  legacy, load, mount, nativeMode, nativeTheme, painted, paintSummary, replaceFixtureExtension, restore,
  rootPaint, run, sample, saveAs, show, slotFile, snapFiles, stateLine, themeSummary, variant, cssOf, historicalSurface,
} from './v-verify-0.3-fixture.mjs';

const [instance, alternative] = process.argv.slice(2);
assert.ok(!alternative || alternative === 'default-on-dark');
await run(instance, process.env.V03_RUN_ID ?? (alternative ? 'alt-upgrade' : 'upgrade'), async ctx => {
  assert.deepEqual(snapFiles(ctx), {}, 'fresh theme directory');
  await nativeMode(ctx.page, 'light', 'light');
  const selected = await nativeTheme(ctx.page, 'light', 'openchamber-light');
  const initial = await eventually(async () => {
    const r = await rootPaint(ctx.page);
    return r.mode === 'light' && painted(r, cssOf(defaults('light'))) && r;
  }, 'unmodified OpenChamber Light');
  const historical = await historicalSurface(ctx.page);
  ctx.record('before-install', { selected, root: initial, historical, summary: paintSummary(initial) });

  await addFromSettings(ctx, '0.2.0');
  await mount(ctx);
  await assetsMatch(ctx, legacy);
  await show(ctx, 'theme');
  if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  const applied = await expectPaint(ctx, {
    label: '0.2 澄潮浅第一次整窗生效', mode: 'light', edit: 'light', legacyMode: true,
    trigger: () => act(ctx, 'load-preset', 'tidemark').click(), def: curated('tidemark', 'light'),
  });
  assert.equal(themeSummary(ctx, 'light').metadata.id, 'openchamber-light');
  const named = 'V03 legacy keepsake';
  const report = await saveAs(ctx, named);
  const paths = ['light', 'dark'].map(v => join(ctx.themes, `theme-studio-v03-legacy-keepsake-${v}.json`));
  const saved = Object.fromEntries(paths.map(p => [basename(p), file(p)]));
  assert.ok(Object.values(saved).every(Boolean), report);
  const live = file(slotFile(ctx, 'light'));
  const beforeBug = snapFiles(ctx);
  ctx.record('legacy-preview-and-named-pair', { saved, live, window: applied.data.after });

  await variant(ctx, 'dark').click();
  for (const id of ['blue-etch', 'kilnmark', 'tidemark']) await act(ctx, 'load-preset', id).click();
  if (alternative) await act(ctx, 'load-default').click();
  await variant(ctx, 'light').click();
  if (!alternative) await act(ctx, 'load-default').click();
  await eventually(async () => (await act(ctx, 'load-default').getAttribute('aria-pressed')) === 'true', '旧面板草稿选中默认');
  await delay(2200);
  const staleRoot = await rootPaint(ctx.page);
  const staleDisk = snapFiles(ctx);
  const staleSample = await sample(ctx);
  const label = await stateLine(ctx);
  const stale = identical(staleDisk, beforeBug) && identical(staleRoot.values, applied.done.values) &&
    load(slotFile(ctx, 'light'))?.themeStudio?.project?.origin?.ref === 'tidemark';
  await ctx.shot(stale ? 'old-stale-default' : 'old-default-different');
  ctx.record('legacy-exact-reproduction', {
    confirmed: stale, sequence: alternative ?? 'default-after-return-to-light', editorTab: 'light',
    selectedDefault: true, draft: staleSample, ui: label, staleDisk,
    root: paintSummary(staleRoot), legacySlot: themeSummary(ctx, 'light'),
  });
  // This is the starting condition for the upgrade, not a bug in the RC.
  assert.ok(stale, '旧版未复现「默认草稿／澄潮窗口／澄潮文件」同一状态，不能声称通过精确升级复测');

  const listenFrom = ctx.assets.length;
  replaceFixtureExtension(ctx);
  const reg = join(ctx.state.openchamberData, 'extensions.json');
  const nativeRegistration = file(reg);
  await ctx.page.reload({ waitUntil: 'domcontentloaded' });
  await mount(ctx);
  await assetsMatch(ctx, candidate, listenFrom);
  await show(ctx, 'theme');
  await delay(1400);
  const afterReload = await rootPaint(ctx.page);
  assert.deepEqual(snapFiles(ctx), staleDisk, 'opening RC after only a reload must not write theme files');
  assert.deepEqual(file(reg), nativeRegistration, 'no reinstall or grant mutation');
  assert.deepEqual(afterReload.values, staleRoot.values);
  assert.equal(await act(ctx, 'load-default').getAttribute('aria-pressed'), 'true', 'recover old default draft');
  ctx.record('new-panel-reopens-passively', { files: snapFiles(ctx), window: paintSummary(afterReload),
    draft: await sample(ctx), status: await stateLine(ctx), sameRegistration: true });

  await variant(ctx, 'dark').click();
  await expectPaint(ctx, { label: '升级后点击深色默认', trigger: () => act(ctx, 'load-default').click(),
    def: defaults('dark'), mode: 'light', edit: 'dark', mustChange: false });
  await expectPaint(ctx, { label: '升级后点击晚照深色', trigger: () => act(ctx, 'load-preset', 'afterglow').click(),
    def: curated('afterglow', 'dark'), mode: 'light', edit: 'dark', project: p => p?.origin.ref === 'afterglow' });
  await ctx.shot('new-dark-afterglow');
  await expectPaint(ctx, { label: '升级后点击焙茶深色', trigger: () => act(ctx, 'load-preset', 'hojicha').click(),
    def: curated('hojicha', 'dark'), mode: 'light', edit: 'dark', project: p => p?.origin.ref === 'hojicha' });
  const restored = await restore(ctx, initial, 'pre-0.2 OpenChamber Light');
  assert.deepEqual(restored.values, initial.values);
  assert.deepEqual(await historicalSurface(ctx.page), historical);
  assert.equal(load(slotFile(ctx, 'light')).metadata.id, 'theme-studio-live-light');
  assert.deepEqual(Object.fromEntries(paths.map(p => [basename(p), file(p)])), saved, 'named-work bytes AND mtime');
  assert.deepEqual(file(reg), nativeRegistration, 'extension reinstall never performed');
  await ctx.shot('native-restored');
  ctx.record('exact-pre-install-restoration', { count: Object.keys(initial.values).length,
    historicalCount: Object.keys(historical).length, before: initial.values, after: restored.values,
    namedUnchanged: saved });
});
