import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openFixture, repo } from './dev-browser.mjs';
import { accent, add, apply, approve, btn, bytes, closeSettings, config, configDiff, css, deleteNative, draft, editorMode,
  exportLight, files, footer, frameNode, importFile, json, openRight, panelState, preview, remove, restore, save,
  selectNative, settings, sidebarNode, switchMode, theme, until, waitColor, waitOriginal, writeFixture } from './v-verify-rc2-ui.mjs';

const status = (ctx, label, timeout = 15_000) => ctx.frame.getByText(label, { exact: true }).waitFor({ timeout });
const builtin = mode => `openchamber-${mode}`;
async function beforeWriting(ctx, stage) {
  const { page, frame, base, dir, record } = ctx;
  const [host, sample, ui, sdk] = await Promise.all([css(page), preview(frame), panelState(frame), ctx.sdk()]);
  const disk = files(dir);
  const writeRequests = sdk.requests.filter(r => r.type === 'file-write');
  record(stage, { host: host.brief, sample, ui, disk, writeRequests });
  assert.deepEqual(host.values, base.values);
  assert.deepEqual(disk, {});
  assert.deepEqual(writeRequests, []);
  return { host, sample, ui, sdk };
}
async function finishSingle(ctx) {
  await deleteNative(ctx, [theme(ctx.slot('light'))]);
  await remove(ctx);
  await waitOriginal(ctx.page, ctx.base);
  assert.deepEqual(files(ctx.dir), {});
}

export async function desktop(ctx) {
  const { page, state, record } = ctx;
  const frame = await approve(ctx);
  const c = config(state.openchamberData);
  record('desktop-preview-selection', await draft(frame, 'Blue Etch', 'Brutalism'));
  await beforeWriting(ctx, 'desktop-preview-did-not-touch-theme-files-or-window');
  const { file } = await apply(ctx, ctx.base);
  const withCache = await until(() => {
    const changes = configDiff(c, config(state.openchamberData));
    return changes['settings.json'].keys.includes('desktopSplashColors') && changes;
  }, 'Electron host persisted splash color cache', 10_000);
  record('desktop-host-cache-while-theme-studio-borrows', { file, changes: withCache });
  await ctx.screenshot('applied');
  await restore(ctx, ctx.base);
  const afterRestore = await until(() => {
    const changes = configDiff(c, config(state.openchamberData));
    return !changes['settings.json'].keys.includes('desktopSplashColors') && changes;
  }, 'host splash cache returned to starting values after plugin restore', 10_000);
  record('desktop-cache-after-plugin-restore-before-native-delete', afterRestore);
  await ctx.screenshot('restored');
  await finishSingle(ctx);
}

export async function slow(ctx, variant) {
  const { page, record, base, dir } = ctx;
  const gate = await ctx.directoryLatency(variant === 'slow' ? 'hold-initial' : 'pass');
  const frame = await approve(ctx);
  if (variant === 'slow') {
    await status(ctx, 'Checking theme files…', 12_000);
    const busy = await beforeWriting(ctx, 'slow-initial-checking-read-only');
    assert.equal(busy.ui.footer, 'Apply');
    assert.equal(busy.ui.footerDisabled, true);
  }
  record('isolated-draft-and-font-sample', await draft(frame, 'Wheat Vellum', 'Brutalism', true));
  const pre = await beforeWriting(ctx, 'after-edit-before-write-or-recheck');
  if (variant === 'slow') {
    await status(ctx, 'Could not read theme files', 27_000);
    await until(() => gate.rows.filter(row => row.phase === 'hold-initial' && row.deliveredAt).length >= 2,
      'two delayed real replies actually delivered after the SDK timeouts', 23_000);
    const failed = await beforeWriting(ctx, 'two-timeouts-readable-error-no-write-draft-survives');
    assert.equal(failed.ui.connection, 'Could not read theme files');
    assert.equal(await frame.getByText('Could not write the theme', { exact: true }).count(), 0);
    assert.equal(failed.ui.footer, 'Copy JSON');
    assert.equal(failed.ui.footerDisabled, false);
    assert.equal(await footer(frame, 'Save as').isEnabled(), false);
    assert.deepEqual(failed.sample, pre.sample);
    const delayed = failed.sdk.requests.filter(row => row.type === 'file-stat' && row.target === 'theme-dir' && row.replyMs > 6500);
    assert.ok(delayed.length >= 2 && delayed.every(row => row.ok === true), 'real late successful directory replies were observed across two attempts');
    record('initial-native-stat-replies-too-late-for-sdk', { delayed, realHTTP: gate.rows });
    await ctx.screenshot('read-failed');
    const button = btn(frame, 'Check files again');
    assert.ok(await button.isEnabled());
    gate.phase = 'explicit-recheck';
    record('clicked-only-check-files-again');
    await button.click();
    await until(async () => await footer(frame, 'Apply').isVisible() && await footer(frame, 'Apply').isEnabled(), 'Apply became available from recheck only', 18_000);
    const recovered = await beforeWriting(ctx, 'explicit-recheck-recovered-and-still-wrote-nothing');
    assert.deepEqual(recovered.sample, failed.sample);
    assert.notEqual(recovered.sample.primary, base.brief.primary);
    assert.ok(gate.rows.some(row => row.phase === 'explicit-recheck' && row.deliveredAt), 'a real directory check ran on explicit recheck');
    await ctx.screenshot('rechecked-without-apply');
    gate.phase = 'pass';
  } else {
    assert.equal(gate.rows.filter(row => row.artificialMs > 0).length, 0);
  }
  await apply(ctx, base, { beforeClick: variant === 'preflight' ? () => { gate.phase = 'delay-one-preflight'; } : undefined });
  if (variant === 'preflight') {
    await until(() => gate.rows.find(row => row.phase === 'delay-one-preflight' && row.artificialMs && row.deliveredAt),
      'injected preflight reply eventually reached the browser', 16_000);
    const sdk = await ctx.sdk();
    const applyMark = ctx.data.observations.find(row => row.stage === 'clicked-visible-apply-once').ms;
    const during = sdk.requests.filter(row => row.ms >= applyMark);
    const stat = during.filter(row => row.type === 'file-stat' && row.target === 'theme-dir');
    const write = during.find(row => row.type === 'file-write');
    assert.ok(stat[0]?.replyMs > 6500 && stat[0]?.ok);
    assert.ok(stat[1]?.ok && stat[1].ms < write?.ms && stat[1].ms + stat[1].replyMs <= write.ms);
    assert.equal(gate.rows.filter(row => row.artificialMs > 0).length, 1);
    record('apply-preflight-retried-the-read-before-first-write', { stat, firstWrite: write });
  }
  await ctx.screenshot('applied');
  await restore(ctx, base);
  await finishSingle(ctx);
  assert.equal(readdirSync(dir).length, 0);
}

export async function web(ctx) {
  const { page, base, dir, state, record } = ctx;
  const light = ctx.slot('light'), dark = ctx.slot('dark');
  const frame = await approve(ctx);
  record('naturally-cold-preview', await draft(frame, 'Wheat Vellum', 'Brutalism', true));
  await beforeWriting(ctx, 'native-web-cold-first-click-checkpoint');
  const { file: first } = await apply(ctx, base);
  await ctx.screenshot('applied');
  await accent(frame, '#2f6a89');
  const edited = await waitColor(page, '#2f6a89', 'light');
  const lightBeforeDark = theme(light);
  assert.equal(lightBeforeDark.id, builtin('light'));
  assert.equal(lightBeforeDark.primary, '#2f6a89');
  assert.notEqual(lightBeforeDark.sha, first.sha);
  record('editing-in-borrow-actually-updated-both-file-and-host', { host: edited.brief, file: lightBeforeDark });

  await settings(page, 'Appearance');
  assert.ok(await page.getByRole('radio', { name: 'System', exact: true }).isChecked());
  await closeSettings(page);
  const darkBase = await switchMode(page, 'dark');
  await btn(frame, 'Apply Dark').waitFor();
  assert.equal(darkBase.brief.primary, '#da7c47');
  assert.equal(theme(dark), null);
  assert.deepEqual(theme(light), lightBeforeDark);
  record('system-dark-did-not-borrow-or-touch-either-file', { host: darkBase.brief, darkFile: null, lightFile: theme(light) });
  await editorMode(frame, 'dark');
  const { file: darkApplied } = await apply(ctx, darkBase, { button: 'Apply Dark' });
  assert.deepEqual(theme(light), lightBeforeDark);
  await switchMode(page, 'light');
  await waitColor(page, lightBeforeDark.primary, 'light');
  await editorMode(frame, 'light');
  const lightRestored = await restore(ctx, base);
  assert.deepEqual(theme(dark), darkApplied);
  await switchMode(page, 'dark');
  await waitColor(page, darkApplied.primary, 'dark');
  await editorMode(frame, 'dark');
  const darkRestored = await restore(ctx, darkBase);
  assert.deepEqual(theme(light), lightRestored);
  record('shallow-and-dark-lanes-restored-independently', { lightRestored, darkRestored, untouchedCounterpartEachTime: true });
  await switchMode(page, 'light');
  await editorMode(frame, 'light');
  await waitOriginal(page, base);
  await ctx.screenshot('restored-light');

  await apply(ctx, base);
  const beforeLong = config(state.openchamberData);
  await btn(frame, 'Use long term').click();
  const persistent = await until(() => {
    const file = theme(light);
    return file?.id === 'theme-studio-live-light' && file;
  }, 'long-term personal slot, no more built-in ID');
  await waitOriginal(page, base);
  const preparedConfig = config(state.openchamberData);
  record('use-long-term-prepares-slot-without-selecting-it', { persistent, host: (await css(page)).brief,
    nativeConfig: configDiff(beforeLong, preparedConfig) });
  await selectNative(page, 'light', persistent.id);
  await status(ctx, 'Connected · visible in OpenChamber');
  record('one-native-appearance-selection-made-long-term-visible', { file: theme(light),
    host: (await waitColor(page, persistent.primary, 'light')).brief, nativeConfig: configDiff(preparedConfig, config(state.openchamberData)) });

  const foreignPath = join(dir, 'theme-studio-rc2-review-work-light.json');
  const foreign = json(light);
  delete foreign.themeStudio;
  foreign.metadata.id = 'theme-studio-rc2-review-work-light';
  foreign.metadata.name = 'RC2 owner fixture (not managed)';
  writeFixture(foreignPath, foreign);
  const preserved = bytes(foreignPath);
  record('controller-created-unmanaged-save-name-collision-in-own-fixture', { path: 'theme-studio-rc2-review-work-light.json', preserved });
  const savedFiles = ['light', 'dark'].map(mode => join(dir, `theme-studio-rc2-review-work-2-${mode}.json`));
  const saveReceipt = await save(frame, 'RC2 Review Work', 'Light and dark');
  const saved = savedFiles.map(theme);
  assert.ok(saved.every(Boolean));
  assert.deepEqual(bytes(foreignPath), preserved);
  await accent(frame, '#824779');
  const editedLong = await waitColor(page, '#824779', 'light');
  assert.equal(theme(light).primary, '#824779');
  assert.equal(theme(light).id, persistent.id);
  assert.deepEqual(savedFiles.map(theme), saved);
  record('save-as-with-name-owner-then-live-edit-without-another-apply', { saveReceipt, saved, ownerBefore: preserved,
    ownerAfter: bytes(foreignPath), activeFile: theme(light), host: editedLong.brief, savedFilesUnchanged: true });

  const downloads = join(state.dir, 'home/Downloads');
  mkdirSync(downloads, { recursive: true, mode: 0o700 });
  const exportReceipt = await exportLight(frame);
  const names = readdirSync(downloads).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 1);
  const exported = join(downloads, names[0]);
  const exportedBefore = theme(exported);
  assert.equal(exportedBefore.primary, '#824779');
  await accent(frame, '#337958');
  await waitColor(page, '#337958', 'light');
  await importFile(frame, exported);
  const imported = await waitColor(page, '#824779', 'light');
  assert.deepEqual(theme(exported), exportedBefore);
  assert.equal(theme(light).primary, '#824779');
  record('real-export-file-selected-and-imported-live', { name: names[0], exportReceipt, exportedBefore,
    exportedAfter: theme(exported), host: imported.brief, actualSlot: theme(light) });

  const malformed = join(downloads, 'rc2-v-truncated.json');
  writeFixture(malformed, '{"metadata":');
  const badSnapshot = async () => ({ native: (await css(page)).brief, draft: await preview(frame), themes: files(dir),
    name: await frame.getByRole('textbox', { name: 'Rename theme' }).inputValue(),
    bad: bytes(malformed), export: bytes(exported) });
  const beforeBad = await badSnapshot();
  const badResult = await importFile(frame, malformed, 'Could not import this theme. Check that it’s OpenChamber theme JSON.');
  const afterBad = await badSnapshot();
  assert.deepEqual(afterBad, beforeBad);
  record('ordinary-bad-format-import-does-not-change-draft-native-or-files', {
    visible: badResult.split('\n').find(line => line.includes('Could not import')), beforeBad, unchanged: true });

  const extraPath = join(downloads, 'rc2-v-harmless-extra-fields.json');
  const extra = json(exported);
  delete extra.themeStudio;
  extra.reviewLabel = 'Ordinary extra label';
  extra.colors.syntax.highlights.sampleAccent = '#476994';
  extra.colors.primary.base = '#79537b';
  writeFixture(extraPath, extra);
  const extraReceipt = bytes(extraPath);
  const details = await importFile(frame, extraPath);
  assert.match(details, /reviewLabel/u);
  assert.match(details, /sampleAccent/u);
  const extraHost = await waitColor(page, '#79537b', 'light');
  const actual = json(light);
  assert.equal(actual.reviewLabel, undefined);
  assert.equal(actual.colors.syntax.highlights.sampleAccent, undefined);
  assert.deepEqual(bytes(extraPath), extraReceipt);
  assert.deepEqual(bytes(foreignPath), preserved);
  record('harmless-extra-keys-visible-then-filtered-with-input-unchanged', { details: details.split('\n')
    .filter(line => /Not used|reviewLabel|sampleAccent/u.test(line)), original: extraReceipt, result: theme(light), host: extraHost.brief });

  await selectNative(page, 'light', builtin('light'));
  await waitOriginal(page, base);
  record('native-return-from-persistent-slot-to-builtin', { host: (await css(page)).brief, savedAndPersonalFilesRemain: files(dir) });
  await deleteNative(ctx, [theme(light), theme(dark), ...saved]);
  assert.deepEqual(files(dir), { 'theme-studio-rc2-review-work-light.json': preserved });
  await remove(ctx);
  await waitOriginal(page, base);
  assert.deepEqual(bytes(foreignPath), preserved);
  record('post-remove-residue-belongs-to-controller-or-explicit-export', {
    unmanagedTheme: bytes(foreignPath), downloads: files(downloads), exportCreatedByPanel: names[0],
    otherDownloadFilesCreatedByController: ['rc2-v-truncated.json', 'rc2-v-harmless-extra-fields.json'] });
}

export async function peer(ctx) {
  const { page, base, state, dir, record } = ctx;
  const frame = await approve(ctx);
  const second = await openFixture(ctx.name);
  const pair = second.page;
  pair.setDefaultTimeout(10_000);
  try {
    assert.notEqual(second.browser, ctx.app.browser);
    assert.equal(second.state.url, state.url);
    await waitOriginal(pair, base);
    await draft(frame, 'Wheat Vellum', 'Brutalism');
    const { file, applied } = await apply(ctx, base);
    assert.deepEqual((await waitColor(pair, file.primary, 'light')).values, applied.values);
    const other = await openRight(ctx, pair);
    await other.getByText(/^(Applied · in place of|Previewing in place of)/u).waitFor();
    const toggle = other.getByRole('switch', { name: 'Update OpenChamber while editing', exact: true });
    if (await toggle.isChecked()) await other.locator('label:has(input[data-change="live"]) .switch-art').click();
    await until(async () => !await toggle.isChecked(), 'second panel explicitly disabled live edit', 5500);
    await accent(other, '#a65b13');
    assert.deepEqual(theme(ctx.slot('light')), file);
    await accent(frame, '#245fb7');
    const [a, b] = await Promise.all([waitColor(page, '#245fb7', 'light'), waitColor(pair, '#245fb7', 'light')]);
    const newFile = theme(ctx.slot('light'));
    const stale = other.locator('footer .footer-apply');
    const staleClicked = await stale.isEnabled();
    if (staleClicked) await stale.click();
    await other.getByText('Theme changed somewhere else', { exact: true }).waitFor();
    assert.deepEqual(theme(ctx.slot('light')), newFile);
    assert.equal((await preview(other)).primary, '#a65b13');
    assert.deepEqual(a.values, b.values);
    record('two-separate-browser-clients-same-server-stale-draft-protected', { url: state.url, first: a.brief, second: b.brief,
      old: file, beforeSecondAttempt: newFile, afterSecondAttempt: theme(ctx.slot('light')), staleClicked, localDraft: await preview(other) });
    await btn(other, 'Load their changes').first().click();
    await until(async () => (await preview(other)).primary === '#245fb7', 'peer explicitly loaded current file');
    await selectNative(pair, 'light', 'flexoki-light');
    const flexoki = await waitColor(pair, '#b54f14', 'light');
    await accent(frame, '#336982');
    const firstAfter = await waitColor(page, '#336982', 'light');
    assert.deepEqual((await css(pair)).values, flexoki.values);
    await restore(ctx, base);
    assert.deepEqual((await css(pair)).values, flexoki.values);
    record('peer-on-another-native-id-unaffected-by-borrow-or-restore', { firstBeforeRestore: firstAfter.brief,
      firstAfterRestore: (await css(page)).brief, second: flexoki.brief, secondNativeId: 'flexoki-light' });
    await selectNative(pair, 'light', builtin('light'));
    await waitOriginal(pair, base);
    await finishSingle(ctx);
    await sidebarNode(pair).waitFor({ state: 'hidden', timeout: 15_000 });
    assert.deepEqual(files(dir), {});
  } finally {
    await second.close();
  }
}

export async function fallback(ctx) {
  const { page, state, record } = ctx;
  const prompt = await add(ctx);
  const refuse = await btn(prompt, 'Not now').isVisible() ? 'Not now' : 'Close';
  await btn(prompt, refuse).click();
  await prompt.waitFor({ state: 'hidden' });
  const pending = btn(page, /Needs approval Theme Studio/u);
  if (!await pending.isVisible()) await btn(page, 'Back to extensions').click();
  await pending.waitFor();
  const pendingLabel = await pending.innerText();
  await ctx.screenshot('native-approval-withheld');
  await closeSettings(page);
  assert.equal(await sidebarNode(page).count(), 0);
  assert.equal(await frameNode(page).count(), 0);
  assert.deepEqual((await ctx.sdk()).requests, []);
  const unapproved = json(join(state.openchamberData, 'extensions.json'));
  assert.deepEqual(unapproved.paths, ['/lab/extension']);
  assert.equal(unapproved.capabilityGrants?.['theme-studio'], undefined);
  // Reopen native approval only after confirming actual denial withheld the panel.
  record('withheld-native-approval-panel-does-not-exist', { refuse, pendingLabel, sidebar: false, iframe: false,
    guestRequests: [], registeredGrantIds: Object.keys(unapproved.capabilityGrants ?? {}) });
  await settings(page, 'Extensions');
  await pending.click();
  await btn(page, 'Review what Theme Studio asks for').click();
  const frame = await approve(ctx, page.getByRole('dialog', { name: 'Allow Theme Studio?' }));
  const unmapped = join(state.dir, 'home/.config/openchamber/themes');
  assert.equal(state.defaultDataDir, false);
  assert.equal(existsSync(unmapped), false);
  await status(ctx, 'Default theme folder not found');
  record('approved-and-opened-but-default-dir-unavailable', await draft(frame, 'Kilnmark', 'Editorial Paper'));
  const noFiles = await beforeWriting(ctx, 'unmapped-not-a-native-permission-refusal');
  const checks = noFiles.sdk.requests.filter(row => row.type === 'file-stat' && row.target === 'theme-dir');
  assert.ok(checks.some(row => row.ok && row.kind === 'missing'));
  record('approved-guest-received-real-stat-missing-not-a-permission-rejection', { checks });
  assert.equal(await footer(frame, 'Apply').count(), 0);
  assert.equal(await footer(frame, 'Save as').isEnabled(), false);
  await footer(frame, 'Copy JSON').click();
  const manual = frame.getByRole('dialog', { name: 'Copy JSON manually' });
  let payload, clipboard;
  if (await manual.waitFor({ timeout: 1600 }).then(() => true, () => false)) {
    payload = await manual.locator('textarea[readonly]').inputValue();
    await btn(manual, 'Done').click();
    clipboard = 'readonly manual dialog';
  } else {
    await status(ctx, 'JSON copied');
    await ctx.app.context.grantPermissions(['clipboard-read'], { origin: state.url });
    payload = await page.evaluate(() => navigator.clipboard.readText());
    clipboard = 'browser clipboard; test granted browser read only after Copy JSON';
  }
  const copied = JSON.parse(payload);
  assert.equal(copied.colors.primary.base, noFiles.sample.primary);
  assert.equal(existsSync(unmapped), false);
  record('preview-only-copy-json-actually-produced-theme-bytes', { clipboard, variant: copied.metadata.variant,
    primary: copied.colors.primary.base, bytes: Buffer.byteLength(payload), actualThemes: files(ctx.dir), defaultDirCreated: false });
  await ctx.screenshot('approved-preview-only');
  await remove(ctx);
  assert.deepEqual(files(ctx.dir), {});
  assert.equal(existsSync(unmapped), false);
}

export async function fixed(ctx) {
  const { base, page, dir, record } = ctx;
  const path = ctx.slot('light');
  const original = json(join(repo, 'presets/reed-shade-light.json'));
  delete original.themeStudio;
  original.metadata.id = 'theme-studio-live-light';
  original.metadata.name = 'RC2 fixture external owner';
  writeFixture(path, original);
  const before = theme(path);
  record('controller-preexisting-fixed-slot-owned-by-other', { before });
  const frame = await approve(ctx);
  await status(ctx, 'Theme changed somewhere else');
  const draftReport = await draft(frame, 'Blue Etch', 'Brutalism');
  assert.equal(await footer(frame, 'Apply').isEnabled(), false);
  assert.deepEqual(theme(path), before);
  assert.deepEqual((await css(page)).values, base.values);
  assert.equal((await ctx.sdk()).requests.some(row => row.type === 'file-write'), false);
  record('fixed-slot-collision-blocked-apply-but-allowed-draft', { ui: await panelState(frame), draft: draftReport,
    originalBefore: before, originalAfter: theme(path), host: (await css(page)).brief });
  await remove(ctx);
  assert.deepEqual(files(dir), { 'theme-studio-live-light.json': bytes(path) });
  assert.deepEqual(theme(path), before);
}
