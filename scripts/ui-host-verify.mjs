#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { cssAccent } from './workshop-browser.mjs';

const [name] = process.argv.slice(2);
if (!/^u-ui-[a-z0-9-]{1,14}$/u.test(name ?? '')) throw new Error('仅用于本任务私有 --name u-ui-* 隔离实例。');
const host = await openFixture(name);
const { state, page } = host;
const temporary = await mkdtemp('/tmp/opencode/theme-studio-ui-host-');
const evidence = join(repo, 'docs/research/evidence');
const title = 'Theme Studio', iframe = page.locator(`iframe[title="${title}"]`);
const steps = [
  ['first', '1  首次打开'], ['apply', '2  整窗应用'], ['edit', '3  改色'],
  ['revert', '4  还原改色'], ['save', '5a  另存'], ['save-edit', '5b  另存后实时改色'], ['import', '6  导入'],
  ['style', '附  风格与能力边界'],
];
const sizes = [320, 420, 720];
const exact = new Map(), errors = [];
let panel;
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(15_000);

async function waitAccent(color) {
  const current = await page.waitForFunction((expected) =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary-base').trim().toLowerCase() === expected,
  color.toLowerCase(), { polling: 75, timeout: 15_000 });
  await current.dispose();
}

async function repaint() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function widthOf(width) {
  const resizer = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role="separator"]');
  for (let attempts = 0; attempts < 3; attempts += 1) {
    const box = await iframe.boundingBox(), grip = await resizer.boundingBox();
    assert.ok(box && grip, 'real right sidebar and its resize handle are visible');
    if (Math.abs(box.width - width) <= 2) return Math.round(box.width);
    const x = grip.x + grip.width / 2, y = grip.y + 32;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + box.width - width, y, { steps: 12 });
    await page.mouse.up();
    await repaint();
  }
  const box = await iframe.boundingBox();
  assert.ok(Math.abs(box.width - width) <= 2, `native resizer: ${Math.round(box.width)}px, expected ${width}px`);
  return Math.round(box.width);
}

async function capture(step) {
  for (const width of sizes) {
    const actual = await widthOf(width);
    exact.set(width, actual);
    const size = await iframe.boundingBox();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    // Keep the live chat/composer in view next to the entire panel. These are
    // crops of the same renderer pixels, not isolated mock cards.
    const x = Math.max(0, Math.floor(size.x - 540));
    await page.mouse.move(x + 5, 60);
    const clip = { x, y: 0, width: dimensions.width - x, height: dimensions.height };
    await repaint();
    await page.screenshot({ clip, path: join(temporary, `${width}-${step}.jpg`), type: 'jpeg', quality: 89, animations: 'disabled' });
  }
  console.log(`PASS native renderer: ${step} (${sizes.map((w) => exact.get(w)).join('/')} px)`);
}

function contactSheet(width) {
  const cells = steps.map(([step, label]) => {
    const input = join(temporary, `${width}-${step}.jpg`), output = join(temporary, `${width}-${step}-caption.jpg`);
    execFileSync('magick', [input, '-resize', '610x510>', '-background', '#e9e7e2', '-gravity', 'North',
      '-splice', '0x26', '-font', 'Noto-Sans-CJK-SC', '-pointsize', '15', '-fill', '#252a2b',
      '-annotate', '+0+4', `${label}  ·  ${exact.get(width)} px`, '-quality', '90', output]);
    return output;
  });
  const output = join(evidence, `ui-host-${width}.jpg`);
  execFileSync('magick', ['montage', ...cells, '-tile', '4x2', '-geometry', '+5+5', '-background', '#d8d6d0', '-strip', '-quality', '86', output]);
  return output;
}

try {
  assert.equal(state.mode, 'desktop', 'requires isolated native OpenChamber');
  assert.equal(state.defaultDataDir, true);
  assert.match(state.openchamberData, /\/\.dev-host\/instances\/u-ui-[^/]+\//);
  await page.setViewportSize({ width: 1440, height: 930 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  // Locale is seeded only in this fixture's own desktop browser profile.
  await page.evaluate(() => localStorage.setItem('openchamber.i18n.v1', JSON.stringify({ locale: 'zh-CN' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[lang^="zh"]').waitFor({ state: 'attached' });
  panel = await openExtension(page, title);
  const status = panel.locator('.connection'), footer = panel.locator('.studio-foot'), dialog = panel.locator('dialog[open]');
  const inline = (act) => panel.locator(`.status-actions [data-act="${act}"]`);
  await panel.locator('.studio[data-locale="zh"]').waitFor();
  await status.filter({ hasText: /^仅面板预览$/u }).waitFor();
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
  await panel.locator('.setup-card').waitFor();
  await inline('try-on').waitFor();
  await panel.locator('.borrow-note').filter({ hasText: /同一服务器.*窗口和设备.*还原/u }).waitFor();
  const original = await cssAccent(page);
  assert.ok(original);
  const fresh = await panel.locator('.sample').evaluate((el) => el.style.getPropertyValue('--v-primary').trim());
  assert.ok(fresh && fresh.toLowerCase() !== original.toLowerCase(), 'use a different palette so renderer changes are observable');
  await capture('first');

  await panel.locator('.setup-card [data-act=dismiss-guide]').click();
  await panel.locator('.setup-card').waitFor({ state: 'hidden' });
  await inline('try-on').waitFor();
  await footer.getByRole('button', { name: '应用', exact: true }).click();
  await waitAccent(fresh);
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  await inline('end-try-on').waitFor();
  await inline('connect').getByText('改为长期使用').waitFor();
  assert.equal(await panel.locator('.connect-guide').count(), 0);
  // Reload the isolated native renderer to destroy the iframe and any
  // in-memory UI state. A sidebar tab can remain mounted while hidden.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[lang^="zh"]').waitFor({ state: 'attached' });
  panel = await openExtension(page, title);
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  assert.equal(await panel.getByText(/上次的试穿还没应用/u).count(), 0);
  assert.equal(await panel.locator('.setup-card').count(), 0);
  await capture('apply');

  const accent = '#176eac', path = 'colors.primary.base';
  await panel.locator(`.sample [data-path="${path}"]`).first().click();
  const hex = panel.locator(`[data-expanded-field="${path}"] [data-picker-hex]`);
  await hex.fill(accent);
  await hex.press('Enter');
  await waitAccent(accent);
  await panel.locator('.draft-mark').filter({ hasText: '草稿未应用' }).waitFor();
  await capture('edit');

  await footer.locator('[data-act=revert]').click();
  await waitAccent(fresh);
  await panel.locator('.draft-mark').waitFor({ state: 'hidden' });
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  await capture('revert');

  await footer.locator('[data-act=save]').click();
  await dialog.getByRole('textbox').fill('工坊验收样张');
  await dialog.getByRole('textbox').press('Enter');
  await dialog.locator('.report-file').nth(1).waitFor();
  const paths = await dialog.locator('.report-file code').allTextContents();
  const saved = paths.find((path) => path.endsWith('-light.json'));
  assert.equal(paths.length, 2);
  assert.ok(saved?.startsWith('~/.config/openchamber/themes/theme-studio-'));
  const savedPath = join(state.openchamberData, 'themes', basename(saved));
  const savedTheme = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.equal(savedTheme.metadata.name, '工坊验收样张');
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  await capture('save');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const afterSave = '#8e3c80';
  await hex.fill(afterSave);
  await hex.press('Enter');
  await waitAccent(afterSave);
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  await panel.locator('.draft-mark').filter({ hasText: '草稿未应用' }).waitFor();
  await capture('save-edit');

  await panel.locator('.studio-menu summary').click();
  await panel.locator('.studio-menu [data-act=import]').click();
  await dialog.locator('input[type=file]').setInputFiles(savedPath);
  await dialog.locator('.success-inline').waitFor();
  assert.equal(await panel.locator('.project-name').inputValue(), savedTheme.metadata.name);
  await waitAccent(fresh);
  await status.filter({ hasText: /^已应用 · 暂借/u }).waitFor();
  await capture('import');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await inline('end-try-on').click();
  await waitAccent(original);
  await inline('end-try-on').waitFor({ state: 'hidden' });
  await panel.locator('#tab-style').click();
  const editorial = panel.locator('[data-act=style][data-id=editorial-paper]');
  await editorial.click();
  await editorial.and(panel.locator('[aria-pressed=true]')).waitFor();
  await panel.locator('.recipe-limits').getByRole('heading', { name: '做不到', exact: true }).waitFor();
  await capture('style');
  assert.equal(await cssAccent(page), original, 'Style exploration after restore does not change the host');
  assert.deepEqual(errors, [], 'no uncaught renderer errors');
  const files = sizes.map(contactSheet);
  const bytes = await Promise.all(files.map(async (file) => (await stat(file)).size));
  assert.ok(bytes.reduce((sum, length) => sum + length, 0) <= 1_500_000, 'three contact sheets within screenshot budget');
  console.log(`PASS real Chinese OpenChamber 2.8.0: ${original} → ${fresh} → ${accent} → ${fresh} → ${afterSave} → ${fresh} → ${original}; reopening had no stale trial banner; ${paths.length} saved files, subsequent edit & import remained live; 0 renderer errors.`);
  console.log(`Evidence: ${files.map((file, i) => `${basename(file)} (${bytes[i]} B)`).join(', ')}`);
} finally {
  await host.close();
  await rm(temporary, { recursive: true, force: true }); // This run's owned screenshot scratch directory.
}
