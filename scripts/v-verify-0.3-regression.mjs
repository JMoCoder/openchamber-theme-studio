import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, button, candidate, cap, closeSettings, curated, defaults, directory,
  eventually, expectPaint, language, liveToggle, load, mount, nativeMode, nativeTheme, restore,
  rootPaint, run, sample, saveAs, settings, show, snapFiles, stateLine, styled, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance] = process.argv.slice(2);
const fixturePng = () => {
  const w = 72, h = 40;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (type, data) => {
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = -1;
    for (const b of bytes) {
      crc ^= b;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const end = Buffer.alloc(4); end.writeUInt32BE((~crc) >>> 0);
    return Buffer.concat([size, bytes, end]);
  };
  const rgb = [[238, 227, 192], [28, 79, 113], [179, 72, 37]], rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0, ...Array.from({ length: w }, (_, x) => rgb[Math.floor(x / 24)]).flat()]));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};

await run(instance, 'regression', async ctx => {
  const { page } = ctx;
  const all = [];
  const check = async (test, fn) => {
    try { const detail = await fn(); const row = { test, ok: true, detail }; all.push(row); ctx.record('regression-case', row); }
    catch (error) {
      const message = error.message.replace(/\/api\/guest-files\/[^/\s"']+/gu, '/api/guest-files/[fixture-asset-grant]');
      const row = { test, ok: false, message, status: await stateLine(ctx).catch(() => null),
        screenshot: await ctx.shot(`${test}-failed`).catch(() => null) };
      all.push(row); ctx.record('regression-case', row);
      const dialog = ctx.frame.locator('dialog[open]');
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
      if (await button(page, /^(Close settings|关闭设置)$/u).isVisible()) await closeSettings(page);
    }
  };
  const menu = async action => {
    const details = ctx.frame.locator('.studio-menu');
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    await details.locator(`[data-act="${action}"]`).click();
  };
  const dialog = () => ctx.frame.locator('dialog[open]');
  const selectLight = async () => {
    if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  };
  const pickSample = async (id, edit = 'light') => {
    await show(ctx, 'theme');
    if (await variant(ctx, edit).getAttribute('aria-pressed') !== 'true') await variant(ctx, edit).click();
    await act(ctx, 'load-preset', id).click();
    await eventually(async () => (await sample(ctx)).background === curated(id, edit).colors.surface.background, `${id} ${edit} in sample`);
    return sample(ctx);
  };
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  const before = await rootPaint(page);
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  const base = curated('tidemark', 'light'), apply = (label, trigger, def) => expectPaint(ctx,
    { label, trigger, def, mode: 'light', edit: 'light' });
  await check('default-style-history', async () => {
    await show(ctx, 'theme');
    await apply('pick Tidemark', () => act(ctx, 'load-preset', 'tidemark').click(), base);
    await show(ctx, 'style');
    const style = styled('eink', base);
    await apply('e-ink', () => act(ctx, 'style', 'eink').click(), style);
    await apply('no-style removes only recipe', () => act(ctx, 'style', '').click(), base);
    await apply('undo restores recipe', () => act(ctx, 'undo').click(), style);
    await apply('redo removes recipe', () => act(ctx, 'redo').click(), base);
    await show(ctx, 'theme');
    await apply('choose Default', () => act(ctx, 'load-default').click(), defaults('light'));
    return { steps: 6 };
  });
  await check('restore', async () => {
    await show(ctx, 'theme');
    await expectPaint(ctx, { label: 'Restore from live non-default palette', trigger: () => act(ctx, 'load-preset', 'hojicha').click(),
      def: curated('hojicha', 'light'), edit: 'light', mode: 'light' });
    const restored = await restore(ctx, before, 'original pre-install renderer');
    return { declarations: Object.keys(restored.values).length };
  });
  await liveToggle(ctx, false);
  await check('save-light-dark-both', async () => {
    await pickSample('hojicha');
    const saves = [
      ['V03 Solo Light', 'light', ['theme-studio-v03-solo-light-light.json']],
      ['V03 Solo Dark', 'dark', ['theme-studio-v03-solo-dark-dark.json']],
      ['V03 Keep Pair', 'both', ['theme-studio-v03-keep-pair-light.json', 'theme-studio-v03-keep-pair-dark.json']],
    ];
    const observed = [];
    for (const [title, mode, names] of saves) {
      const old = snapFiles(ctx);
      const message = await saveAs(ctx, title, mode);
      const now = snapFiles(ctx);
      assert.deepEqual(Object.keys(now).filter(k => !old[k]), names.toSorted());
      for (const name of names) assert.equal(load(join(ctx.themes, name)).metadata.variant, name.includes('-dark.json') ? 'dark' : 'light');
      observed.push({ mode, names, message, fingerprints: Object.fromEntries(names.map(k => [k, now[k]])) });
    }
    return observed;
  });
  await check('list-remove-and-undo', async () => {
    await show(ctx, 'theme');
    const name = 'V03 Keep Pair';
    const selector = button(ctx.frame, `Delete or remove ${name}`);
    await selector.click();
    const old = snapFiles(ctx);
    await button(dialog(), 'Remove from My themes only').click();
    await selector.waitFor({ state: 'hidden' });
    const disclosure = ctx.frame.locator('.saved-removed');
    await disclosure.waitFor();
    if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
    await button(ctx.frame, `Undo removal of ${name}`).click();
    await selector.waitFor();
    assert.deepEqual(snapFiles(ctx), old);
    return { pairUnchanged: snapFiles(ctx) };
  });
  await check('native-delete-then-verify', async () => {
    await show(ctx, 'theme');
    await button(ctx.frame, 'Delete or remove V03 Keep Pair').click();
    const original = snapFiles(ctx);
    for (const v of ['light', 'dark']) {
      await settings(page, 'appearance');
      await button(page.getByRole('group', { name: 'Themes', exact: true }), cap(v)).click();
      const item = page.getByRole('listbox', { name: `${cap(v)} theme`, exact: true })
        .locator(`[data-theme-id="theme-studio-v03-keep-pair-${v}"]`);
      await button(item, /delete|remove/iu).click();
      const confirm = button(page, /^(Delete|Remove)$/u).filter({ visible: true });
      if (await confirm.waitFor({ timeout: 1000 }).then(() => true, () => false)) await confirm.click();
      await eventually(() => !snapFiles(ctx)[`theme-studio-v03-keep-pair-${v}.json`], `native deletion of ${v}`);
    }
    await closeSettings(page);
    await button(dialog(), 'Verify file deletion').click();
    const message = dialog().getByText('All listed files are gone.', { exact: true });
    await message.waitFor();
    const disk = snapFiles(ctx);
    assert.deepEqual(disk, Object.fromEntries(Object.entries(original).filter(([k]) => !k.includes('-keep-pair-'))));
    await button(dialog(), 'Done').click();
    return { disk, panel: 'All listed files are gone.' };
  });
  await check('export', async () => {
    const downloads = join(ctx.state.dir, 'home/Downloads');
    mkdirSync(downloads, { recursive: true, mode: 0o700 });
    assert.equal(realpathSync(downloads), downloads);
    await menu('export');
    const select = dialog().getByRole('combobox');
    await select.press('Home');
    assert.equal(await select.inputValue(), 'both');
    await button(dialog(), 'Export to Downloads').click();
    await dialog().getByText('Exported to Downloads.', { exact: true }).waitFor();
    const files = directory(downloads);
    assert.equal(Object.keys(files).length, 2);
    assert.deepEqual(new Set(Object.keys(files).map(k => load(join(downloads, k)).metadata.variant)), new Set(['light', 'dark']));
    await button(dialog(), 'Done').click();
    return { files };
  });
  await check('copy-json', async () => {
    await selectLight();
    await menu('copy-json');
    const manual = ctx.frame.locator('textarea.manual-json');
    const toast = ctx.frame.locator('.studio-toast').getByText('JSON copied', { exact: true });
    const channel = await eventually(async () => await manual.isVisible() ? 'manual-fallback' :
      await toast.isVisible() ? 'native' : null, 'clipboard success or manual fallback', 5000);
    let text;
    if (channel === 'manual-fallback') {
      text = await manual.inputValue();
      await page.keyboard.press('Escape');
    } else {
      await ctx.context.grantPermissions(['clipboard-read'], { origin: new URL(page.url()).origin });
      text = await page.evaluate(() => navigator.clipboard.readText());
    }
    const json = JSON.parse(text);
    assert.equal(json.metadata.variant, 'light');
    assert.ok(json.colors.surface.background);
    return { channel, color: json.colors.surface.background, characters: text.length };
  });
  await check('import-valid-and-invalid', async () => {
    await menu('import');
    const text = dialog().getByRole('textbox');
    await text.fill('{"metadata": broken');
    await button(dialog(), 'Import JSON').click();
    await dialog().getByText(/Could not import this theme/u).waitFor();
    assert.equal(await text.getAttribute('aria-invalid'), 'true');
    const d = curated('afterglow', 'light');
    await text.fill(JSON.stringify(d));
    await button(dialog(), 'Import JSON').click();
    await dialog().getByText('Theme imported', { exact: true }).waitFor();
    await button(dialog(), 'Done').click();
    await eventually(async () => (await sample(ctx)).background === d.colors.surface.background, 'imported palette is in the sample');
    return { badRejected: true, sample: await sample(ctx) };
  });
  await check('image', async () => {
    await show(ctx, 'theme');
    await act(ctx, 'image').click();
    const choose = page.waitForEvent('filechooser', { timeout: 5000 });
    await button(ctx.frame, 'Choose image').click();
    await (await choose).setFiles({ name: 'studio-fixture.png', mimeType: 'image/png', buffer: fixturePng() });
    await act(ctx, 'image-seed', '0').waitFor();
    const prior = await sample(ctx);
    await act(ctx, 'image-seed', '0').click();
    const next = await eventually(async () => {
      const current = await sample(ctx); return current.background !== prior.background && current;
    }, 'actual decoded image palette');
    return { prior, next };
  });
  await check('random', async () => {
    await show(ctx, 'theme');
    const before = await sample(ctx);
    await act(ctx, 'random').click();
    return eventually(async () => {
      const changed = await sample(ctx); return changed.primary !== before.primary && changed;
    }, 'new randomized palette');
  });
  await check('counterpart', async () => {
    await pickSample('afterglow');
    await show(ctx, 'tune');
    await act(ctx, 'counterpart', 'dark').click();
    await variant(ctx, 'dark').click();
    return eventually(async () => {
      const changed = await sample(ctx); return changed.background !== curated('afterglow', 'dark').colors.surface.background && changed;
    }, 'generate a dark palette that was not the bundled dark edition');
  });
  await check('refine', async () => {
    await pickSample('tidemark');
    const before = await sample(ctx);
    await ctx.frame.locator('.sample [data-path="colors.surface.background"]').first().click();
    const row = ctx.frame.locator('[data-expanded-field="colors.surface.background"]');
    await row.waitFor();
    const hex = row.getByRole('textbox').first();
    await hex.click();
    await hex.press('Control+a');
    await hex.pressSequentially('#ede5d5');
    await hex.press('Enter');
    const after = await eventually(async () => {
      const s = await sample(ctx); return s.background === '#ede5d5' && s;
    }, 'a manually refined canvas color');
    return { before, after };
  });
  await check('repair-readability', async () => {
    await show(ctx, 'tune');
    const score = ctx.frame.locator('.audit-metric strong');
    const before = +(await score.textContent());
    await act(ctx, 'repair').click();
    await ctx.frame.getByText(/Readability: \d+ → \d+|No measurable change was needed/u).waitFor();
    const after = +(await score.textContent());
    assert.ok(after >= before);
    return { before, after };
  });
  await check('language-and-preview-off', async () => {
    const disk = snapFiles(ctx), rootBefore = await rootPaint(page);
    await language(ctx, 'zh');
    await language(ctx, 'en');
    assert.deepEqual(snapFiles(ctx), disk);
    await pickSample('afterglow', 'dark');
    await delay(3000);
    assert.deepEqual(snapFiles(ctx), disk);
    assert.deepEqual((await rootPaint(page)).values, rootBefore.values);
    assert.match((await stateLine(ctx)).text, /window preview off/u);
    return { themeFilesUnchanged: disk, sample: await sample(ctx), status: await stateLine(ctx) };
  });
  ctx.record('regression-summary', { coverage: all.map(({ test, ok }) => [test, ok]) });
  assert.ok(all.every(row => row.ok), 'see cases for failures and coverage');
});
