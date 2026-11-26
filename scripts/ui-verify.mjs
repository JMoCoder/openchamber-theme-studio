#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveUi } from './ui-serve.mjs';
import defaults from '../src/data/builtin-defaults.json' with { type: 'json' };
import { themesDir, slotPath } from '../src/host/library.mjs';
import en from '../src/i18n/ui.en.mjs';
import zh from '../src/i18n/ui.zh.mjs';
import { STYLE_RECIPES } from '../shared/style-recipes.mjs';
import presetIndex from '../presets/index.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = process.env.UI_EVIDENCE_DIR ?? join(root, 'docs/research/evidence');
const widths = [320, 420, 720], modes = ['light', 'dark'], locales = ['zh', 'en'];
const tabs = ['theme', 'style', 'tune', 'refine', 'matching'];
const cases = ['booting', 'unavailable', 'read-error', 'paused', 'off', 'idle', 'active', 'tryon', 'hidden', 'writing', 'waiting', 'timeout',
  'conflict', 'error', 'verify-error', 'borrow-inactive', 'borrow-unknown', 'ambiguous', 'extreme'];
// The first card is Default / No style.
const themeCards = presetIndex.presets.length + 1, styleCards = STYLE_RECIPES.length + 1;
const shots = process.argv.includes('--screens');
const interactionsOnly = process.argv.includes('--interactions-only');
const sandboxOnly = process.argv.includes('--sandbox-only');
const guttersOnly = process.argv.includes('--gutters-only');

const playwright = process.env.UI_PLAYWRIGHT
  ? await import(pathToFileURL(process.env.UI_PLAYWRIGHT))
  : await import('playwright').catch(() => {
    throw new Error('Install Playwright in your test toolchain or set UI_PLAYWRIGHT to an existing playwright/index.mjs.');
  });
const fixture = await serveUi();
const chromium = await playwright.chromium.launch({ headless: true });
const temporary = await mkdtemp('/tmp/opencode/theme-studio-ui-verify-');
const pageErrors = [];
const track = (page) => {
  page.setDefaultTimeout(8500);
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));
  page.on('request', (request) => {
    if (!new URL(request.url()).href.startsWith(`${fixture.url}/`) && !/^(?:data|blob):/.test(request.url())) pageErrors.push(`External request: ${request.url()}`);
  });
};
const act = (page, name) => page.locator(`[data-act="${name}"]`);
const field = (page, path) => page.locator(`[data-act="field"][data-path="${path}"]`);
const sample = (page, path) => page.locator(`.sample [data-path="${path}"]`).first();
const mark = (value) => console.log(value);
const atFrame = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
const snapshot = (page) => page.evaluate(() => {
  const s = window.__uiDev.studio.getState();
  return { project: s.project, live: s.live, dirty: s.dirty, history: s.history, notice: s.notice, phase: s.phase,
    host: s.host, variant: s.variant, library: { saved: s.library.saved, removed: s.library.removed } };
});
const rounds = (xs) => xs.slice().sort((a, b) => a - b).map((x) => Math.round(x * 100) / 100);
const percentile = (xs, p) => xs[Math.max(0, Math.ceil(xs.length * p) - 1)] ?? 0;
const distribution = (xs, label) => {
  const seq = rounds(xs);
  return `${label} n=${seq.length} p50=${percentile(seq, .5)}ms p95=${percentile(seq, .95)}ms max=${seq.at(-1)}ms`;
};
const boot = (qs) => `${fixture.url}/?${new URLSearchParams(qs)}`;
const canvasPath = 'colors.surface.background', bubblePath = 'colors.chat.userMessageBackground';

async function open(page, qs = {}) {
  await page.goto(boot(qs));
  await page.locator('[data-ready=true]').waitFor();
}
async function tab(page, id) {
  await page.locator(`#tab-${id}`).click();
  await page.locator(`#tab-${id}[aria-selected=true]`).waitFor();
}
async function menuAction(page, action) {
  const menu = page.locator('.studio-menu');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await act(menu, action).click();
}
const hostWrites = (page) => page.evaluate(() => window.__uiDev.control.writes.map(({ path }) => path));
async function noMoreWrites(page, prior) {
  // The mock's write debounce is 120 ms; allow the editor and host to drain.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 350)));
  assert.deepEqual(await hostWrites(page), prior);
}
async function screenshot(page, path) {
  await page.mouse.move(1, 1);
  await page.screenshot({ animations: 'disabled', type: 'jpeg', quality: 87, path });
}
function stitch(files, width, columns, height, path) {
  const args = ['montage', ...files, '-background', '#aaa7a1', '-thumbnail', `${width}x${height}>`, '-tile', `${columns}x`,
    '-geometry', `+5+5`, '-quality', '86', path];
  const result = spawnSync('magick', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

async function drag(page, target, { horizontal = false, steps = 25 } = {}) {
  await atFrame(page);
  await target.scrollIntoViewIfNeeded();
  const b = await target.boundingBox();
  assert.ok(b);
  const start = { x: b.x + b.width * .12, y: b.y + b.height * .50 };
  const end = { x: b.x + b.width * .84, y: b.y + b.height * (horizontal ? .50 : .70) };
  await page.mouse.move(start.x, start.y);
  await page.evaluate(() => {
    const measure = window.__uiDev.cadence = { active: true, samples: [] };
    let previous;
    const frame = (now) => {
      if (!measure.active) return;
      if (previous != null) measure.samples.push(now - previous);
      previous = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(start.x + (end.x - start.x) * i / steps, start.y + (end.y - start.y) * i / steps);
    // A real mouse stream spaced by the browser's cadence, not synthetic timing.
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  const cadence = await page.evaluate(() => {
    window.__uiDev.cadence.active = false;
    return window.__uiDev.cadence.samples;
  });
  await atFrame(page);
  return cadence;
}

async function interactions() {
  const page = await chromium.newPage({ viewport: { width: 420, height: 850 }, reducedMotion: 'reduce' });
  track(page);
  await open(page, { locale: 'en', core: 'real', scenario: 'legacy-paused' });
  assert.equal(await page.locator('.theme-card').count(), themeCards);
  assert.match(await page.locator('.connection').innerText(), /Panel preview only.*off/);
  const rename = page.locator('.project-name');
  await rename.fill('Workbench QA'); await rename.press('Enter');
  assert.equal((await snapshot(page)).project.name, 'Workbench QA');
  await act(page, 'undo').click();
  await atFrame(page);
  assert.notEqual((await snapshot(page)).project.name, 'Workbench QA');
  const themeTab = page.locator('#tab-theme');
  await themeTab.focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('#tab-style[aria-selected=true]').waitFor();
  assert.equal(await page.locator('.style-grid button').count(), styleCards);
  await page.locator('[data-act=style][data-id=eink]').click();
  assert.equal((await snapshot(page)).project.style.light.id, 'eink');
  assert.equal(await page.locator('.recipe-limits').count(), 0);
  await page.locator('[data-change=style-option]').selectOption('warm');
  assert.equal((await snapshot(page)).project.style.light.options.ink, 'warm');
  const styleCadence = await drag(page, page.locator('input[data-knob=strength]'), { horizontal: true, steps: 20 });
  assert.ok((await snapshot(page)).project.style.light.strength < 1);
  assert.equal((await snapshot(page)).project.style.light.strength, (await snapshot(page)).project.style.dark.strength);
  const styleFrames = await page.evaluate(() => window.__uiDev.frames.splice(0));
  await page.locator('[data-act=style][data-id=""]').click();
  assert.equal((await snapshot(page)).project.style.light.id, null);

  await tab(page, 'tune');
  const tune = page.locator('input[data-knob=hue][data-knob-group=all]');
  const tuneStart = (await snapshot(page)).project.tune.light.global.hue;
  const tuneCadence = await drag(page, tune, { horizontal: true, steps: 35 });
  const moved = (await snapshot(page)).project.tune.light.global.hue;
  assert.notEqual(moved, tuneStart);
  assert.equal((await snapshot(page)).project.tune.dark.global.hue, moved);
  await act(page, 'undo').click();
  assert.equal((await snapshot(page)).project.tune.light.global.hue, tuneStart);
  await act(page, 'redo').click();
  assert.equal((await snapshot(page)).project.tune.light.global.hue, moved);
  const tuneFrames = await page.evaluate(() => window.__uiDev.frames.splice(0));
  await atFrame(page);
  await tune.scrollIntoViewIfNeeded();
  const tunePoint = await tune.boundingBox();
  assert.ok(tunePoint, 'range remains visible after redo');
  const sliderHandle = await tune.elementHandle();
  const knobPoint = [tunePoint.x + tunePoint.width * .72, tunePoint.y + tunePoint.height * .50];
  await page.mouse.click(...knobPoint);
  await atFrame(page);
  assert.ok(await sliderHandle.evaluate((element) => element.isConnected), 'range stays mounted across the first click');
  await page.mouse.click(...knobPoint, { clickCount: 2 });
  assert.equal((await snapshot(page)).project.tune.light.global.hue, 0);
  await page.locator('[data-change=tune-group]').selectOption('syntax');
  await page.locator('input[data-knob=hue][data-knob-group=syntax]').press('ArrowRight');
  assert.equal((await snapshot(page)).project.tune.light.groups.syntax.hue, 1);
  const keepStatus = page.locator('input[data-change=protect-status]');
  await keepStatus.locator('..').click(); await atFrame(page);
  assert.equal((await snapshot(page)).project.tune.light.protectStatus, false);
  assert.equal((await snapshot(page)).project.tune.dark.protectStatus, false);
  await keepStatus.press('Space'); await atFrame(page);
  assert.equal((await snapshot(page)).project.tune.light.protectStatus, true);
  await act(page, 'counterpart').first().click();
  assert.equal((await snapshot(page)).project.base.light.metadata.variant, 'light');
  await act(page, 'undo').click();
  await act(page, 'repair').click();
  await page.locator('.repair-compare').waitFor();

  await tab(page, 'refine');
  const search = page.locator('[data-input=search]');
  await search.fill('bubble');
  if (!(await field(page, bubblePath).count())) await search.fill('userMessageBackground');
  await field(page, bubblePath).waitFor();
  await search.fill('layoutAnimations');
  assert.equal(await page.locator('.field-row').count(), 0);
  await sample(page, bubblePath).click();
  await page.locator('[data-expanded-field="colors.chat.userMessageBackground"] [data-picker]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.path), bubblePath);
  const hex = page.locator('[data-picker-hex]');
  await hex.fill('#11'); await hex.press('Enter');
  await page.locator('[data-picker-hex][aria-invalid=true]').waitFor();
  await hex.fill('#d1188aaa'); await hex.press('Enter');
  assert.equal((await snapshot(page)).project.overrides.light[bubblePath], '#d1188aaa');
  await page.locator('.picker-advanced summary').click();
  const css = page.locator('[data-picker-css]');
  await css.fill('var(--some-color)'); await css.press('Enter');
  await page.locator('[data-picker-css][aria-invalid=true]').waitFor();
  await css.evaluate((el) => { el.setSelectionRange(1, 4); });
  await page.evaluate(() => window.__uiDev.setLocale('zh-CN'));
  await page.locator('#root[data-locale=zh]').waitFor();
  assert.equal(await page.locator('.picker-advanced').getAttribute('open'), '');
  assert.match(await page.locator('.picker-error').innerText(), /CSS/);
  assert.deepEqual(await css.evaluate((el) => [el.value, el.selectionStart, el.selectionEnd, el === document.activeElement]),
    ['var(--some-color)', 1, 4, true]);
  assert.equal(await page.locator('.picker-enter button[title]').first().getAttribute('title'), '设置颜色');
  await page.evaluate(() => window.__uiDev.setLocale('en-GB'));
  await page.locator('#root[data-locale=en]').waitFor();
  await css.fill('oklch(64% 0.14 248)'); await css.press('Enter');
  assert.equal((await snapshot(page)).project.overrides.light[bubblePath], 'oklch(64% 0.14 248)');
  const pickerCadence = await drag(page, page.locator('[data-picker-surface]'), { steps: 35 });
  const shade = (await snapshot(page)).project.overrides.light[bubblePath];
  assert.match(shade, /^#[\da-f]{6}([\da-f]{2})?$/);
  const pickerFrames = await page.evaluate(() => window.__uiDev.frames.splice(0));
  const alpha = page.locator('[data-picker-alpha]');
  await alpha.press('ArrowLeft'); await atFrame(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'picker:alpha');
  await alpha.press('ArrowLeft'); await atFrame(page);
  assert.notEqual((await snapshot(page)).project.overrides.light[bubblePath], shade);
  await alpha.press('Control+z'); await atFrame(page);
  await page.getByRole('button', { name: 'Follow palette', exact: true }).click();
  assert.equal((await snapshot(page)).project.overrides.light[bubblePath], undefined);
  await hex.fill('#d1188a'); await hex.press('Enter');
  await tab(page, 'style');
  for (const recipe of ['', 'eink']) {
    const tile = page.locator(`[data-act=style][data-id="${recipe}"] .theme-tile`);
    assert.equal(await tile.evaluate((el) => el.style.getPropertyValue('--tile-bubble')), '#d1188a');
  }
  await tab(page, 'matching');
  assert.equal(await page.locator('.limits-inline').count(), 0);
  await page.locator('#font-uiFont').waitFor({ state: 'attached' });
  await page.getByRole('combobox', { name: 'Try a family installed on this device: Interface font' }).fill('A font not installed 7721');
  await page.getByText('Not detected; showing a fallback', { exact: true }).first().waitFor();
  await act(page, 'copy-text').first().click();
  assert.ok(await page.evaluate(() => window.__uiDev.readClipboard()));
  await page.evaluate(() => window.__uiDev.setLocale('zh-CN'));
  await page.locator('#root[data-locale=zh]').waitFor();
  assert.equal(await page.locator('#tab-matching').innerText(), '搭配');
  await page.evaluate(() => window.__uiDev.setLocale('en-GB'));
  await page.locator('#root[data-locale=en]').waitFor();
  await act(page, 'toggle-preview').click(); await page.locator('.preview-frame[hidden]').waitFor({ state: 'attached' });
  await act(page, 'toggle-preview').click(); await page.locator('.preview-frame').waitFor();
  for (const width of [320, 720, 420]) {
    await page.setViewportSize({ width, height: 770 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }

  await tab(page, 'theme');
  await act(page, 'toggle-builtins').click();
  await page.locator('.builtin-cards button').first().waitFor();
  assert.equal(await page.locator('.builtin-cards button').count(), 31);
  await act(page, 'toggle-builtins').click();
  await act(page, 'image').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d'); g.fillStyle = '#ffb650'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#1c5477'; g.fillRect(0, 0, 16, 32);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#image-file').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await act(page, 'image-seed').first().waitFor();
  await act(page, 'image-seed').first().click();
  assert.equal((await snapshot(page)).project.origin.kind, 'image');
  await act(page, 'random').click();
  assert.equal((await snapshot(page)).project.origin.kind, 'random');
  await page.locator('main [data-act=import]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('{"tokenColors":[]}');
  await dialog.getByRole('button', { name: 'Import JSON' }).click();
  await dialog.getByText('This looks like a VS Code theme.', { exact: false }).waitFor();
  const native = await page.evaluate(() => {
    const file = structuredClone(window.__uiDev.studio.getState().resolved.light);
    file.colors.exampleUnknown = '#fff';
    return JSON.stringify(file);
  });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: Buffer.from(native) });
  await dialog.getByText('Theme imported', { exact: true }).waitFor();
  await dialog.getByText('colors.exampleUnknown', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await act(page, 'variant').filter({ hasText: 'Light' }).click();
  await atFrame(page);

  await act(page, 'save').click();
  await dialog.getByRole('textbox').fill('Workbench QA files');
  await dialog.getByRole('button', { name: 'Save to file', exact: true }).click();
  await dialog.getByText('Theme saved to file.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.report-file').count(), 2);
  await dialog.locator('.report-file button').first().click();
  assert.match(await page.evaluate(() => window.__uiDev.readClipboard()), /^~\/\.config\/openchamber\/themes\/theme-studio-/);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await menuAction(page, 'export');
  await dialog.getByRole('button', { name: 'Export to Downloads', exact: true }).click();
  await dialog.getByText('Exported to Downloads.', { exact: true }).waitFor();
  assert.match(await dialog.locator('.report-file code').first().innerText(), /^~\/Downloads\/openchamber-theme-studio-/);
  await page.keyboard.press('Escape');
  assert.ok((await hostWrites(page)).every((path) => ![slotPath('light'), slotPath('dark')].includes(path)));

  mark('PASS real Studio + mock host: five tabs, style/tune/refine gestures, live picker translation + selection, image/native JSON import, save/export');
  mark(distribution(styleFrames, 'style drag (Studio + mini preview)'));
  mark(distribution(tuneFrames, 'tune drag (Studio + mini preview)'));
  mark(distribution(pickerFrames, 'picker drag (Studio + mini preview + ratios)'));
  mark(distribution(styleCadence, 'style rAF cadence'));
  mark(distribution(tuneCadence, 'tune rAF cadence'));
  mark(distribution(pickerCadence, 'picker rAF cadence'));
  await page.close();
}

// Every tile stays visible beside the controls it opens, with one option or two;
// neither the tile nor a passing message ends up underneath them.
async function styleControls(page, locale, width, mode) {
  for (const { id } of [STYLE_RECIPES[0], STYLE_RECIPES[5], STYLE_RECIPES.at(-1), { id: 'constructivist' }, STYLE_RECIPES[0]]) {
    const tile = page.locator(`[data-act=style][data-id="${id}"]`);
    await tile.click();
    await page.locator(`[data-act=style][data-id="${id}"][aria-pressed=true]`).waitFor();
    await atFrame(page);
    const at = await page.evaluate((key) => {
      const box = (el) => { const { top, bottom } = el.getBoundingClientRect(); return { top, bottom }; };
      const bar = document.querySelector('.style-settings'), toast = document.querySelector('.studio-toast');
      const label = bar.querySelector('.range-label > span');
      return { tile: box(document.querySelector(`[data-act=style][data-id="${key}"]`)), bar: box(bar), main: box(document.querySelector('main')),
        toast: toast.hidden ? null : box(toast), label: label.textContent, labelFits: label.scrollWidth <= label.clientWidth };
    }, id);
    const note = `${locale} ${width} ${id}: ${JSON.stringify(at)}`;
    assert.ok(at.tile.top >= at.main.top - 1 && at.tile.bottom <= at.bar.top + 1, note);
    assert.ok(at.bar.bottom <= at.main.bottom + 1, note);
    if (at.toast) assert.ok(at.toast.bottom <= at.bar.top, note);
    assert.ok(at.label.startsWith(locale === 'zh' ? '强度' : 'Strength'), note);
    assert.ok(at.labelFits, note);
    if (shots && id === 'constructivist' && width === 320 && locale === 'en' && mode === 'light') {
      await screenshot(page, join(evidence, 'strength-label-320-en.jpg'));
    }
  }
  assert.ok(await page.locator('.studio-toast').isVisible(), `${locale} ${width}: the restore message is still showing`);
}

async function layouts() {
  const readiness = [];
  let checks = 0;
  for (const locale of locales) for (const mode of modes) {
    const mosaic = [];
    for (const width of widths) {
      const page = await chromium.newPage({ viewport: { width, height: 824 }, reducedMotion: 'reduce' });
      track(page);
      await open(page, { locale, mode });
      readiness.push(await page.evaluate(() => performance.getEntriesByName('studio-first-ready')[0].startTime));
      assert.equal(await act(page, 'load-default').innerText(), locale === 'zh' ? '默认' : 'Default');
      await act(page, 'load-preset').first().click();
      await act(page, 'load-default').click();
      await act(page, 'toggle-builtins').click();
      await act(page, 'load-builtin').first().click();
      await act(page, 'toggle-builtins').click();
      await page.locator('.studio-menu summary').press('Enter');
      const previewSwitch = page.getByRole('switch', { name: locale === 'zh' ? '整窗实时预览' : 'Live window preview' });
      await previewSwitch.press('Space');
      await page.locator('.connection').filter({ hasText: locale === 'zh' ? '整窗预览已关' : 'window preview off' }).waitFor();
      await act(page, 'save').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox').fill('QA');
      await dialog.getByRole('button', { name: locale === 'zh' ? '取消' : 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await act(page, 'restore').click();
      for (const name of tabs) {
        if (name !== 'theme') await tab(page, name);
        if (name === 'style') {
          await page.locator('[data-act=style][data-id=editorial-paper]').click();
          await page.locator('[data-act=style][data-id=editorial-paper][aria-pressed=true]').waitFor();
          await styleControls(page, locale, width, mode);
          await page.locator('[data-act=style][data-id=editorial-paper]').click();
          await page.locator('main').evaluate((region) => { region.scrollTop = 0; });
        }
        if (name === 'refine') await sample(page, bubblePath).click();
        await atFrame(page);
        const layout = await page.evaluate(() => ({
          viewport: innerWidth, doc: document.documentElement.scrollWidth,
          mainScroll: document.querySelector('main').scrollWidth, mainClient: document.querySelector('main').clientWidth,
          main: document.querySelector('main').getBoundingClientRect().height,
          foot: document.querySelector('footer').getBoundingClientRect().height,
          right: document.querySelector('.footer-actions').getBoundingClientRect().right,
        }));
        assert.equal(layout.viewport, layout.doc, `${locale} ${mode} ${width} ${name}: no horizontal overflow`);
        assert.ok(layout.mainScroll <= layout.mainClient, `${locale} ${mode} ${width} ${name}: ${JSON.stringify(layout)}`);
        assert.ok(layout.main > 220 && layout.foot <= 55 && layout.viewport >= layout.right, JSON.stringify(layout));
        if (shots) {
          const path = join(temporary, `ui-${locale}-${mode}-${width}-${name}.jpg`);
          await screenshot(page, path); mosaic.push(path);
        }
        checks++;
      }
      await page.close();
    }
    if (shots) stitch(mosaic, 308, 5, 650, join(evidence, `ui-matrix-${locale}-${mode}.jpg`));
  }
  mark(`PASS ${checks} matrix cells: 5 tabs × 3 widths × 2 host modes × 2 languages; footer, scroll region, overflow`);
  mark(distribution(readiness, 'cold fixture ready (navigation through second rAF, screenshot browser)'));
}

/** 0.3.1: wide panels cap every card at 240 px and add columns; the narrow layouts stay as in 0.3.0. */
async function wideGrid() {
  const cardMax = 240, narrow = { 320: [2, 2, 2], 420: [3, 3, 3], 720: [3, 5, 5] };
  const grid = (page, selector) => page.evaluate(({ selector, cardMax }) => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element);
    const columns = style.gridTemplateColumns.split(' ').length, gap = parseFloat(style.columnGap);
    const cards = [...element.children].map((child) => child.getBoundingClientRect().width);
    const inner = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const clipped = [...element.querySelectorAll('*')].filter((node) => node.childElementCount === 0 && node.scrollWidth > node.clientWidth + 1
      && getComputedStyle(node).overflow !== 'visible').length;
    return { columns, widest: Math.max(...cards), fewer: columns > 1 ? (inner - (columns - 2) * gap) / (columns - 1) : Infinity, clipped, cardMax };
  }, { selector, cardMax });
  const rows = [];
  for (const locale of locales) for (const width of [320, 420, 720, 900, 1280, 1940, 2600]) {
    const page = await chromium.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    track(page);
    await open(page, { locale, mode: 'light' });
    const preset = await grid(page, '.preset-cards');
    await act(page, 'toggle-builtins').click();
    await page.locator('.builtin-cards button').first().waitFor();
    const builtin = await grid(page, '.builtin-cards');
    if (shots && locale === 'zh' && width === 1940) await screenshot(page, join(evidence, 'panel-wide-1940-zh-theme.jpg'));
    await tab(page, 'style');
    const style = await grid(page, '.style-grid');
    if (shots && locale === 'zh' && width === 1940) await screenshot(page, join(evidence, 'panel-wide-1940-zh-style.jpg'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const label = `${locale} ${width}`;
    assert.equal(overflow, 0, `${label}: no horizontal overflow`);
    for (const [name, g] of Object.entries({ preset, builtin, style })) assert.equal(g.clipped, 0, `${label} ${name}: no clipped text`);
    if (narrow[width]) {
      assert.deepEqual([preset.columns, builtin.columns, style.columns], narrow[width], `${label}: narrow layout unchanged`);
    } else {
      for (const [name, g] of Object.entries({ preset, builtin, style })) {
        assert.ok(g.widest <= cardMax + .5, `${label} ${name}: card ${g.widest} px exceeds ${cardMax} px`);
        if (width >= 1100) assert.ok(g.fewer > cardMax, `${label} ${name}: one column fewer would still fit (${g.fewer} px)`);
      }
      if (width >= 1100) assert.ok(preset.columns === builtin.columns && builtin.columns === style.columns, `${label}: both tabs share columns`);
    }
    rows.push(`${locale} ${width}: ${preset.columns}/${builtin.columns}/${style.columns} cols, ≤${Math.round(Math.max(preset.widest, builtin.widest, style.widest))} px`);
    await page.close();
  }
  mark(`PASS wide card grid: ${rows.length} cases; narrow 2/3/3-5 columns unchanged, wide cards ≤${cardMax} px with the fewest columns, both tabs aligned`);
  mark(`  ${rows.filter((row) => row.startsWith('zh')).join('; ')}`);
}

async function states() {
  const page = await chromium.newPage({ viewport: { width: 320, height: 820 }, reducedMotion: 'reduce' });
  track(page);
  const numbers = [];
  for (const scenario of cases) {
    await open(page, { scenario, locale: 'en' });
    const main = await page.locator('main').boundingBox();
    assert.ok(main.height > 170, `editor stays on screen: ${scenario}`);
    const footer = await page.locator('footer').boundingBox();
    assert.ok(footer.height < 54, `footer stays one row: ${scenario}`);
    const line = await page.locator('.connection').innerText();
    if (scenario === 'unavailable') {
      assert.match(line, /no file access/);
      assert.ok(await act(page, 'save').isDisabled());
      await menuAction(page, 'copy-json');
      assert.match(await page.evaluate(() => window.__uiDev.readClipboard()), /"metadata"/);
    }
    if (scenario === 'conflict') {
      assert.ok(await act(page, 'resolve-load').isVisible());
      assert.ok(await act(page, 'resolve-overwrite').isVisible());
    }
    if (scenario === 'read-error') assert.ok(await act(page, 'recheck-files').isVisible());
    if (scenario === 'extreme') {
      const result = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById('root'));
        const color = (name) => style.getPropertyValue(`--u-${name}`);
        const sample = getComputedStyle(document.querySelector('.sample'));
        return { bg: color('bg'), fg: color('fg'), radius: color('radius'), sample: sample.getPropertyValue('--v-background') };
      });
      assert.notEqual(result.bg, '#ff09fa');
      assert.equal(result.sample, '#ff09fa');
      assert.notEqual(result.bg, result.fg);
      assert.equal(result.radius, '11px');
    }
    if (shots) {
      const path = join(temporary, `ui-state-${scenario}.jpg`);
      await screenshot(page, path); numbers.push(path);
    }
  }
  if (shots) stitch(numbers, 232, 4, 480, join(evidence, 'ui-connection-states.jpg'));
  mark(`PASS ${cases.length} state fixtures (including extreme host, denied, recovery, timeout, late states)`);
  await page.close();
}

/** 0.3.1: a preview file carries its origin, so uninstall + reinstall can still restore; 0.3.0 leftovers get a safe path. */
async function reinstallRecovery(writtenIn) {
  const zh = writtenIn === 'zh', path = slotPath('light');
  const slot = (page) => page.evaluate((path) => JSON.parse(window.__uiDev.control.workspace.files.get(path)?.content ?? 'null'), path);
  const released = (page) => page.waitForFunction((path) => {
    const file = window.__uiDev.control.workspace.files.get(path);
    return file && JSON.parse(file.content).metadata.id !== 'openchamber-light' && !window.__uiDev.studio.getState().live.light.readError;
  }, path);
  const fits = (page, selector) => page.locator(selector).first().evaluate((element) => element.scrollWidth <= element.clientWidth + 1 &&
    [...element.querySelectorAll('*')].every((node) => node.childElementCount > 0 || node.scrollWidth <= node.clientWidth + 1));
  async function previewThenUninstall({ legacy = null } = {}) {
    const page = await chromium.newPage({ viewport: { width: 320, height: 824 }, reducedMotion: 'reduce' });
    track(page);
    await open(page, { locale: writtenIn, mode: 'light', core: 'real' });
    await page.locator('[data-act=load-preset][data-id=tidemark]').click();
    await page.waitForFunction(() => window.__uiDev.studio.getState().live.light.sync === 'applied');
    const writes = await hostWrites(page);
    assert.deepEqual(writes, [path]);
    const record = await slot(page);
    assert.equal(record.metadata.id, 'openchamber-light', 'the preview borrows the selected built-in');
    assert.ok(Object.hasOwn(record.themeStudio, 'origin'), '0.3.1 preview files carry their origin');
    const marker = record.metadata.name.replace(record.themeStudio.project.name, '…');
    assert.equal(marker, zh ? 'Theme Studio · …（试穿）' : 'Theme Studio · … (trying on)');
    if (legacy) {
      // Rewrite the file the way 0.3.0 left it: no origin, optionally the slot's own ID.
      const old = structuredClone(record);
      delete old.themeStudio.origin;
      if (legacy === 'self') {
        old.metadata.id = 'theme-studio-live-light';
        delete old.themeStudio.borrowedApplied; delete old.themeStudio.borrowBaseline;
      }
      await page.evaluate(({ path, content }) => window.__uiDev.control.workspace.putFile(path, content), { path, content: `${JSON.stringify(old)}\n` });
      if (legacy === 'self') await page.evaluate(() => window.__uiDev.control.select('theme-studio-live-light', 'light'));
    }
    await page.evaluate(() => window.__uiDev.reopen({ afterUninstall: true }));
    await noMoreWrites(page, writes);
    return { page, writes, marker };
  }

  { // Reopen after uninstall writes nothing; one Restore releases the borrowed built-in.
    const { page, writes } = await previewThenUninstall();
    assert.equal(await act(page, 'recovery-guide').count(), 0);
    assert.equal(await act(page, 'recover-builtin').count(), 0);
    assert.doesNotMatch(await page.locator('.connection').innerText(), zh ? /无法找回|旧预览/u : /unavailable|Old preview/u);
    await act(page, 'restore').click();
    await released(page);
    assert.ok((await hostWrites(page)).length > writes.length);
    await page.close();
  }
  { // Keep previewing after reinstall, then restore.
    const { page } = await previewThenUninstall();
    await page.locator('[data-act=load-preset][data-id=hojicha]').click();
    await page.waitForFunction(() => window.__uiDev.studio.getState().live.light.sync === 'applied');
    assert.equal((await slot(page)).metadata.id, 'openchamber-light');
    await act(page, 'restore').click();
    await released(page);
    await page.close();
  }
  { // A 0.3.0 leftover that borrows a built-in: one button, both languages, no retry.
    const { page, writes, marker } = await previewThenUninstall({ legacy: 'builtin' });
    await page.locator('.connection').filter({ hasText: zh ? '旧预览待恢复' : 'Old preview to clear' }).waitFor();
    const recover = act(page, 'recover-builtin');
    assert.equal(await recover.getAttribute('data-id'), 'openchamber-light');
    assert.equal(await act(page, 'retry').count(), 0);
    assert.equal(await act(page, 'recovery-guide').count(), 0);
    for (const [lang, label] of [['en-US', 'Restore built-in colors'], ['zh-CN', '恢复内置配色']]) {
      await page.evaluate((lang) => window.__uiDev.setLocale(lang), lang);
      await recover.filter({ hasText: label }).waitFor();
      assert.ok(await fits(page, '.u-banner'), `${lang}: banner fits 320 px`);
      if (shots && writtenIn === 'zh') await screenshot(page, join(evidence, `legacy-recover-320-${lang.slice(0, 2)}.jpg`));
    }
    await menuAction(page, 'cleanup');
    const details = page.getByRole('dialog').locator('details');
    await details.locator('summary').press('Enter');
    await details.getByText(marker, { exact: false }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await noMoreWrites(page, writes);
    await recover.click();
    await released(page);
    await page.close();
  }
  { // A 0.3.0 leftover under the slot's own ID: nothing can verify the original, so nothing is overwritten.
    const { page, writes } = await previewThenUninstall({ legacy: 'self' });
    await page.locator('.connection').filter({ hasText: zh ? '无法找回原配色' : 'Original colors unavailable' }).waitFor();
    assert.equal(await act(page, 'recover-builtin').count(), 0);
    assert.equal(await act(page, 'retry').count(), 0);
    const before = await slot(page);
    await act(page, 'restore').click();
    await noMoreWrites(page, writes);
    assert.deepEqual(await slot(page), before);
    await act(page, 'recovery-guide').click();
    await page.getByRole('dialog').getByRole('heading', { name: zh ? '保留目前的配色' : 'Keep the current colors' }).waitFor();
    assert.ok(await page.getByRole('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth));
    await page.keyboard.press('Escape');
    await noMoreWrites(page, writes);
    await page.close();
  }
  mark(`PASS reinstall after a ${writtenIn} preview: silent reopen, one-click Restore, keep previewing; 0.3.0 leftovers recover a built-in or stay untouched; 320 px fit`);
}

async function previewAndLibrary() {
  const page = await chromium.newPage({ viewport: { width: 320, height: 824 }, reducedMotion: 'reduce' });
  track(page);
  await open(page, { locale: 'zh-CN', core: 'real', scenario: 'legacy-paused' });
  const initial = await snapshot(page);
  assert.equal(initial.host.active.light.id, 'flexoki-light');
  const choosePreset = (slug = 'tidemark') => page.locator(`[data-act=load-preset][data-id="${slug}"]`).click();
  const selectStyle = (id = '') => page.locator(`[data-act=style][data-id="${id}"]`).click();
  const setLocale = async (lang) => {
    await page.evaluate((value) => window.__uiDev.setLocale(value), lang);
    await page.locator(`#root[data-locale=${lang}]`).waitFor();
  };
  const selectVariant = (v) => page.locator(`[data-act=variant][data-value="${v}"]`).click();
  const setHostMode = (v) => page.evaluate((value) => window.__uiDev.control.setMode(value), v);
  const waitPreview = (v) => page.waitForFunction((value) => {
    const s = window.__uiDev.studio.getState();
    return s.live[value].sync === 'applied' && s.live[value].borrowed?.inUse === true &&
      s.host.tokens.primary === s.resolved[value].colors.primary.base;
  }, v);
  const status = page.locator('.connection');
  await status.filter({ hasText: '整窗预览已关' }).waitFor();
  await choosePreset();
  await tab(page, 'style'); await selectStyle('eink');
  await noMoreWrites(page, []);
  await page.locator('.studio-menu summary').press('Enter');
  let windowSwitch = page.getByRole('switch', { name: '整窗实时预览', exact: true });
  assert.equal(await windowSwitch.isChecked(), false);
  if (shots) await screenshot(page, join(evidence, 'panel-320-zh-preview-switch.jpg'));
  await windowSwitch.focus();
  await setLocale('en');
  windowSwitch = page.getByRole('switch', { name: 'Live window preview', exact: true });
  await windowSwitch.waitFor();
  assert.equal(await windowSwitch.evaluate((el) => el === document.activeElement), true);
  if (shots) await screenshot(page, join(evidence, 'panel-320-en-preview-switch.jpg'));
  await windowSwitch.press('Space');
  assert.equal(await windowSwitch.isChecked(), true);
  await noMoreWrites(page, []);

  await tab(page, 'theme');
  await choosePreset(); // The selected card still reloads and clears the recipe.
  await waitPreview('light');
  assert.equal((await snapshot(page)).project.style.light.id, null);
  assert.ok((await hostWrites(page)).every((path) => path === slotPath('light')));
  await tab(page, 'tune');
  await page.locator('input[data-knob=hue][data-knob-group=all]').press('ArrowRight');
  await sample(page, 'colors.primary.base').click();
  const hex = page.locator('[data-picker-hex]');
  await hex.fill('#2f49a1'); await hex.press('Enter');
  await waitPreview('light');
  const edited = (await snapshot(page)).project;
  assert.equal(edited.tune.light.global.hue, 1);
  assert.equal(edited.overrides.light['colors.primary.base'], '#2f49a1');
  await tab(page, 'style'); await selectStyle('eink');
  await page.locator('[data-knob=strength]').press('ArrowLeft');
  assert.ok((await snapshot(page)).project.style.light.strength < 1);
  await tab(page, 'theme'); await choosePreset();
  assert.ok(Object.values((await snapshot(page)).project.style).every((layer) => layer.id === null));
  assert.deepEqual((await snapshot(page)).project.tune, edited.tune);
  assert.deepEqual((await snapshot(page)).project.overrides, edited.overrides);
  const palette = await page.evaluate(() => window.__uiDev.studio.getState().resolved.light.colors);
  await tab(page, 'style'); await selectStyle('eink');
  assert.notDeepEqual(await page.evaluate(() => window.__uiDev.studio.getState().resolved.light.colors), palette);
  await selectStyle();
  assert.deepEqual(await page.evaluate(() => window.__uiDev.studio.getState().resolved.light.colors), palette);
  await selectStyle('eink');
  await tab(page, 'theme'); await act(page, 'toggle-builtins').click();
  const native = page.locator('.builtin-cards [data-act=load-builtin][data-id=flexoki]');
  await native.click();
  await page.waitForFunction(() => window.__uiDev.studio.getState().project.origin.ref === 'flexoki');
  assert.ok(Object.values((await snapshot(page)).project.style).every((layer) => layer.id === null));
  assert.deepEqual((await snapshot(page)).project.tune, edited.tune);
  assert.deepEqual((await snapshot(page)).project.overrides, edited.overrides);
  const beforeDefault = (await snapshot(page)).project;
  await act(page, 'load-default').click();
  const nativeDefault = await page.evaluate(() => window.__uiDev.studio.getState().resolved);
  for (const v of modes) assert.deepEqual(nativeDefault[v].colors, defaults[v].colors);
  assert.deepEqual((await snapshot(page)).project.overrides, { light: {}, dark: {} });
  await act(page, 'undo').click();
  assert.deepEqual((await snapshot(page)).project, beforeDefault);
  await act(page, 'toggle-builtins').click();
  await waitPreview('light');

  // The rapid Default → Undo sequence above can defer a last write until the
  // preceding receipt resolves. It is not caused by the following mode switch.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 480)));
  // Editing the other edition paints it into the file the window really uses.
  await selectVariant('dark'); await choosePreset('kilnmark');
  await status.filter({ hasText: 'Previewing Dark in a Light-mode window' }).waitFor();
  const crossed = await hostWrites(page);
  assert.equal(crossed.at(-1), slotPath('light'));
  assert.ok(!crossed.includes(slotPath('dark')));
  // A real mode switch by the host is never followed by a write of our own.
  await setHostMode('dark');
  await noMoreWrites(page, crossed);
  await choosePreset('kilnmark');
  await waitPreview('dark');
  assert.equal((await hostWrites(page)).at(-1), slotPath('dark'));

  const dialog = page.getByRole('dialog'), name = 'QA / 色彩作品';
  const beforeSave = await snapshot(page);
  const beforeSaveWrites = await hostWrites(page);
  await act(page, 'save').click();
  const input = dialog.getByRole('textbox');
  await input.fill(name);
  await input.evaluate((el) => el.setSelectionRange(1, 4));
  await setLocale('zh');
  assert.equal(await dialog.getByRole('heading').innerText(), '保存为文件');
  assert.deepEqual(await input.evaluate((el) => [el.value, el.selectionStart, el.selectionEnd]), [name, 1, 4]);
  assert.equal(await dialog.getByRole('combobox').getAttribute('aria-label'), '选择版本');
  await input.press('Enter');
  await dialog.getByText('主题已保存为文件。', { exact: true }).waitFor();
  const afterSave = await snapshot(page), card = afterSave.library.saved[0];
  assert.equal(card.name, name);
  assert.deepEqual(afterSave.host.tokens, beforeSave.host.tokens);
  assert.equal(afterSave.host.active.dark.reason, 'ambiguous', 'the new named copy and the painted slot now match');
  assert.equal(afterSave.live.dark.selectionBlocked, true);
  assert.deepEqual(afterSave.project, beforeSave.project);
  const savedOnly = modes.map((v) => card.variants[v].path);
  assert.deepEqual(await hostWrites(page), [...beforeSaveWrites, ...savedOnly]);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();

  const beforeRestore = await hostWrites(page);
  await page.evaluate(() => window.__uiDev.reopen());
  await act(page, 'restore').click();
  await page.waitForFunction(() => window.__uiDev.studio.getState().host.active.dark?.kind === 'builtin');
  assert.equal((await snapshot(page)).host.active.dark.id, 'flexoki-dark');
  assert.deepEqual((await snapshot(page)).project, initial.project);
  assert.equal((await snapshot(page)).variant, initial.variant);
  const restoredPaths = (await hostWrites(page)).slice(beforeRestore.length);
  assert.deepEqual(restoredPaths.toSorted(), modes.map(slotPath).toSorted());
  await setHostMode('light');
  await page.waitForFunction(() => window.__uiDev.studio.getState().host.active.light?.kind === 'builtin');
  assert.equal((await snapshot(page)).host.active.light.id, 'flexoki-light');
  assert.deepEqual((await snapshot(page)).host.tokens, initial.host.tokens);
  assert.equal(await page.locator('[data-act=apply], [data-act=try-on], .setup-card').count(), 0);

  // A native deletion is independently simulated on the mock host, not by this panel.
  const manage = act(page, 'manage-saved');
  await manage.click();
  assert.equal(await manage.getAttribute('aria-label'), `删除或移除「${name}」`);
  await dialog.getByText('在「设置 → 外观」的「主题」中选浅色或深色', { exact: false }).waitFor();
  assert.deepEqual(await dialog.locator('code').allTextContents(), savedOnly);
  if (shots) await screenshot(page, join(evidence, 'panel-320-zh-native-delete.jpg'));
  const verify = dialog.getByRole('button', { name: /^(核实是否已删除|Verify file deletion)$/ });
  const beforeDelete = await hostWrites(page);
  await verify.click();
  await dialog.getByText('文件仍然存在。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '复制深色文件路径', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiDev.readClipboard()), card.variants.dark.path);
  await page.evaluate((path) => window.__uiDev.control.workspace.dir.delete(path), themesDir);
  await verify.click();
  await dialog.getByText('无法核实删除结果', { exact: false }).waitFor();
  await page.evaluate((path) => window.__uiDev.control.workspace.dir.add(path), themesDir);
  await page.evaluate((path) => window.__uiDev.control.deleteFile(path), card.variants.light.path);
  await verify.click();
  await dialog.getByText('部分文件已删除，其余版本仍保留。', { exact: true }).waitFor();
  assert.deepEqual(Object.keys((await snapshot(page)).library.saved[0].variants), ['dark']);
  await setLocale('en');
  assert.equal(await dialog.getByRole('heading').innerText(), 'Delete theme files');
  await dialog.getByText('Some files are gone.', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Copy Dark file path', exact: true }).waitFor();
  if (shots) await screenshot(page, join(evidence, 'panel-320-en-native-delete.jpg'));
  await dialog.getByRole('button', { name: 'Remove from My themes only', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.saved-removed summary').getByText('Removed', { exact: true }).waitFor();
  assert.equal(await page.evaluate((path) => window.__uiDev.control.workspace.files.has(path), card.variants.dark.path), true);
  await page.evaluate(() => window.__uiDev.reopen());
  const removed = page.locator('.saved-removed');
  await removed.waitFor();
  assert.equal(await removed.getAttribute('open'), null);
  await removed.locator('summary').press('Enter');
  await act(page, 'undo-remove-saved').press('Space');
  await manage.click();
  assert.deepEqual(await dialog.locator('code').allTextContents(), [card.variants.dark.path]);
  await page.evaluate((path) => window.__uiDev.control.deleteFile(path), card.variants.dark.path);
  await verify.click();
  await dialog.getByText('All listed files are gone.', { exact: true }).waitFor();
  assert.equal((await snapshot(page)).library.saved.length, 0);
  assert.deepEqual(await hostWrites(page), beforeDelete);
  await page.close();
  mark('PASS 320 px real core + mock host: legacy switch and locale, repick/style/tune, exact default/Undo, safe inactive mode, file save, restore across remount, checked native deletion, persistent list-only removal/undo');
}

async function namedPreviewNotice(locale) {
  const words = locale === 'zh' ? zh : en;
  const page = await chromium.newPage({ viewport: { width: 320, height: 824 }, reducedMotion: 'reduce' });
  track(page);
  await open(page, { locale, core: 'real', scenario: 'known' });
  const file = await page.evaluate(async () => {
    const { studio, control } = window.__uiDev;
    await studio.start();
    studio.setLive(false);
    studio.loadPreset('blue-etch');
    const { files: [work] } = await studio.saveAs({ name: 'Original A', variants: ['light'] });
    control.workspace.refresh();
    control.select(work.id);
    studio.setLive(true);
    return { ...work, original: control.workspace.files.get(work.path).content };
  });
  const notice = page.locator('[data-note="saved-preview"]');
  assert.equal(await notice.count(), 0);
  await page.locator('[data-act=load-preset][data-id=tidemark]').click();
  await notice.getByText(words.savedPreviewFirst, { exact: true }).waitFor();
  const fit = await notice.evaluate((el) => {
    const page = el.ownerDocument.documentElement, box = el.getBoundingClientRect();
    const body = page.querySelector('.studio-main').getBoundingClientRect();
    return page.clientWidth === 320 && page.scrollWidth === 320 && el.scrollWidth <= el.clientWidth &&
      box.left >= 0 && box.right <= 320 && box.bottom <= body.top;
  });
  assert.ok(fit, `${locale}: first notice sits above the editor without clipping or covering it`);
  await act(page, 'show-status-help').click();
  await page.locator('.studio-banners').getByText(words.savedPreviewEffect, { exact: true }).waitFor();
  await act(page, 'show-status-help').click();
  await page.waitForFunction((path) => {
    const { studio, control } = window.__uiDev;
    const envelope = JSON.parse(control.workspace.files.get(path).content).themeStudio;
    return envelope.origin && studio.getState().live.light.sync === 'applied';
  }, file.path);
  await act(page, 'save').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(words.savedOutputHint, { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('textbox').inputValue(), 'Original A');
  await dialog.getByRole('button', { name: words.cancel, exact: true }).click();
  await act(page, 'restore').click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate((path) => window.__uiDev.control.workspace.files.get(path).content, file.path), file.original);
  await page.locator('[data-act=load-preset][data-id=tidemark]').click();
  await page.waitForFunction((path) => {
    const { studio, control } = window.__uiDev;
    return JSON.parse(control.workspace.files.get(path).content).themeStudio.origin &&
      studio.getState().live.light.sync === 'applied';
  }, file.path);
  assert.equal(await notice.count(), 0);
  assert.deepEqual(await hostWrites(page), Array(4).fill(file.path));
  await page.close();
  mark(`PASS 320 px ${locale} named preview: translated inline first notice, help, one-time display, original bytes restored`);
}

async function passiveBoundaries() {
  const page = await chromium.newPage({ viewport: { width: 420, height: 824 }, reducedMotion: 'reduce' });
  track(page);
  await open(page, { core: 'real', scenario: 'read-error' });
  await act(page, 'recheck-files').waitFor();
  await page.evaluate(() => window.__uiDev.control.recoverReads());
  await act(page, 'recheck-files').click();
  await page.locator('.connection').getByText('Edit to preview in the window', { exact: true }).waitFor();
  await tab(page, 'style'); await tab(page, 'theme');
  await noMoreWrites(page, []);

  await page.evaluate(() => {
    const { studio, control } = window.__uiDev;
    const theme = structuredClone(studio.getState().resolved.light);
    Object.assign(theme.metadata, { id: 'external-fixture', name: 'Personal palette' });
    theme.colors.surface.background = '#abc4bd'; theme.colors.primary.base = '#18c6d2';
    control.workspace.addTheme(theme); control.select(theme.metadata.id);
  });
  await page.locator('.connection').getByText('Panel preview only', { exact: true }).waitFor();
  await act(page, 'load-preset').first().click();
  assert.equal((await snapshot(page)).project.origin.kind, 'preset');
  await noMoreWrites(page, []);

  await open(page, { core: 'real', scenario: 'unavailable' });
  assert.ok(await act(page, 'save').isDisabled());
  await act(page, 'load-preset').first().click();
  assert.equal((await snapshot(page)).project.origin.kind, 'preset');
  await noMoreWrites(page, []);
  await page.close();
  mark('PASS real core: open/recheck/tab navigation do not write; unknown and ungranted stay panel-only on an active click');
}

async function signatures() {
  const page = await chromium.newPage({ viewport: { width: 450, height: 900 }, reducedMotion: 'reduce' });
  track(page);
  await open(page, { preview: 'hide' });
  await page.addStyleTag({ content: `.preset-cards,.style-grid { grid-template-columns: repeat(3,120px); }
    .theme-card { grid-template-rows: auto; } .theme-card-caption,.theme-card-detail { display: none !important; }` });
  for (const [selector, label] of [['.preset-cards', 'preset'], ['.style-grid', 'style']]) {
    if (label === 'style') await tab(page, 'style');
    const grid = page.locator(selector);
    const n = label === 'preset' ? themeCards : styleCards;
    assert.equal(await grid.locator('.theme-card').count(), n);
    assert.equal(await grid.locator('.theme-card').first().evaluate((el) => el.getBoundingClientRect().width), 120);
    const colors = await grid.locator('.theme-card').evaluateAll((cards) => cards.map((c) =>
      Array.from(c.querySelectorAll('.theme-tile-signature i'), (i) => getComputedStyle(i).backgroundColor).join('|')));
    assert.equal(new Set(colors).size, n, `${label} color signatures must be unique`);
    if (shots) await grid.screenshot({ path: join(temporary, `${label}-signatures.jpg`), type: 'jpeg', quality: 93 });
  }
  if (shots) stitch(['preset', 'style'].map((v) => join(temporary, `${v}-signatures.jpg`)), 450, 2, 600,
    join(evidence, 'ui-signatures-120.jpg'));
  await page.close();
  mark(`PASS unnamed 120 px thumbnail signatures: ${themeCards} theme pairs and ${styleCards} style cards`);
}

async function sandboxForms() {
  const page = await chromium.newPage({ viewport: { width: 460, height: 900 }, reducedMotion: 'reduce' });
  track(page);
  const messages = [];
  page.on('console', (message) => { if (message.type() === 'error') messages.push(message.text()); });
  await page.goto(`${fixture.url}/sandbox`);
  const shell = page.locator('iframe');
  assert.equal(await shell.getAttribute('sandbox'), 'allow-scripts');
  const guest = shell.contentFrame();
  await guest.locator('[data-ready]').waitFor();
  const dialog = guest.getByRole('dialog');
  await guest.locator('footer [data-act=save]').click();
  const name = dialog.getByRole('textbox');
  await name.fill(' '); await name.press('Enter');
  await dialog.getByText('Enter a theme name.').waitFor();
  await name.fill('Sandbox QA'); await name.press('Enter');
  await dialog.getByText('Theme saved to file.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.report-file').count(), 2);
  await page.keyboard.press('Escape');
  await guest.locator('.studio-menu summary').click();
  await guest.locator('.menu-tray [data-act=export]').click();
  await dialog.getByRole('button', { name: 'Export to Downloads', exact: true }).press('Space');
  await dialog.getByText('Exported to Downloads.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.report-file').count(), 1);
  await page.keyboard.press('Escape');
  await guest.locator('.studio-menu summary').click();
  await guest.locator('.menu-tray [data-act=import]').click();
  const def = await guest.locator('#root').evaluate(() => JSON.stringify(window.__uiDev.studio.getState().resolved.light));
  const paste = dialog.getByRole('textbox');
  await paste.fill(def); await paste.press('Control+Enter');
  await dialog.getByText('Theme imported', { exact: true }).waitFor();
  assert.equal(await guest.locator('form').count(), 0);
  await page.goto(`${fixture.url}/sandbox?clipboard=unavailable`);
  await guest.locator('[data-ready]').waitFor();
  await guest.locator('.studio-menu summary').click();
  await guest.locator('.menu-tray [data-act=copy-json]').click();
  const jsonText = dialog.getByRole('textbox', { name: 'Copy JSON manually' });
  await jsonText.waitFor();
  const manual = await jsonText.evaluate((el) => ({ value: el.value, readOnly: el.readOnly, from: el.selectionStart, to: el.selectionEnd }));
  assert.equal(JSON.parse(manual.value).metadata.variant, 'light');
  assert.equal(manual.readOnly, true);
  assert.equal(manual.from, 0);
  assert.equal(manual.to, manual.value.length);
  assert.deepEqual(messages, []);
  mark('PASS iframe allow-scripts only: save keyboard + 2 paths, export keyboard + 1 path, paste keyboard, clipboard-denied manual JSON');
  await page.close();
}

async function gutters(source) {
  const bundle = async (path, file) => {
    const output = join(temporary, file);
    const build = spawnSync('bun', ['build', join(source, 'packages/sdk/src', path), '--target=browser', '--format=esm', `--outfile=${output}`],
      { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || String(build.error));
    return import(pathToFileURL(output));
  };
  const [{ GUEST_SCROLLBAR_CSS, GUEST_SCROLLBAR_SCRIPT }, { GUEST_UI_LOOK_CSS }] = await Promise.all([
    bundle('scrollbar-style.ts', 'sdk-scrollbar.mjs'), bundle('ui/style.ts', 'sdk-look.mjs'),
  ]);
  const rows = [];
  const measure = (frame) => frame.evaluate(() => {
    const main = document.querySelector('main'), cards = [...document.querySelectorAll('.preset-cards .theme-card')];
    const rect = (node) => { const { x, width } = node.getBoundingClientRect(); return [x, width]; };
    const end = cards.reduce((right, card) => card.getBoundingClientRect().right > right.getBoundingClientRect().right ? card : right);
    return {
      geom: { root: rect(document.getElementById('root')), main: rect(main), inner: rect(main.firstElementChild),
        first: rect(cards[0]), last: rect(cards.at(-1)), rightmost: rect(end), footer: rect(document.querySelector('footer')), fixtureWidth: innerWidth,
        rootLeftover: innerWidth - document.documentElement.clientWidth, gutter: main.offsetWidth - main.clientWidth },
      css: getComputedStyle(main).scrollbarColor, thumb: getComputedStyle(main, '::-webkit-scrollbar-thumb').backgroundColor,
      marker: main.hasAttribute('data-oc-scrolling'), hover: main.matches(':hover'), focus: document.hasFocus(),
      canScroll: main.scrollHeight > main.clientHeight, scroll: main.scrollTop,
    };
  });
  for (const locale of locales) for (const width of widths) for (const length of ['short', 'long']) {
    const height = length === 'short' ? 1450 : 740;
    // The sandbox still permits scripts only. CSP bypass lets this isolated
    // test append the exact host SDK injection after the panel stylesheet.
    const page = await chromium.newPage({ viewport: { width: width + 118, height: height + 36 }, bypassCSP: true, reducedMotion: 'reduce' });
    track(page);
    await page.goto(`${fixture.url}/sandbox?${new URLSearchParams({ core: 'fake', locale, width, height })}`);
    const iframe = page.locator('iframe');
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('[data-ready=true]').waitFor();
    await frame.evaluate(({ css, script }) => {
      const meta = document.createElement('meta');
      meta.name = 'color-scheme'; meta.content = 'light dark'; document.head.prepend(meta);
      const style = document.createElement('style');
      style.setAttribute('data-openchamber-guest-styles', '');
      style.textContent = css;
      const run = document.createElement('script');
      run.textContent = script;
      document.body.append(style, run);
    }, { css: GUEST_SCROLLBAR_CSS + GUEST_UI_LOOK_CSS, script: GUEST_SCROLLBAR_SCRIPT });
    await frame.locator('html[data-oc-scrollbar-activity]').waitFor({ state: 'attached' });
    if (length === 'long') await act(frame, 'toggle-builtins').click();
    await frame.locator('main').evaluate((el) => { el.scrollTop = 0; });
    const outside = page.locator('#outside');
    const region = await frame.locator('main').boundingBox();
    const foot = await frame.locator('footer').boundingBox();
    const atFooter = () => page.mouse.move(foot.x + foot.width / 2, foot.y + foot.height / 2);
    await atFooter();
    await frame.locator('main:not([data-oc-scrolling])').waitFor({ state: 'attached' });
    const rest = await measure(frame);
    assert.equal(rest.hover, false, 'initial measurement is outside the scroll region');
    assert.equal(rest.canScroll, length === 'long');
    assert.equal(rest.geom.rootLeftover, 0);
    assert.equal(rest.geom.gutter, 6);
    await page.mouse.move(region.x + region.width - 26, region.y + 38);
    await atFrame(frame);
    const hover = await measure(frame);
    assert.equal(hover.hover, true);
    assert.equal(hover.css, 'auto');
    if (length === 'long') assert.notEqual(hover.thumb, rest.thumb);
    await page.mouse.wheel(0, 268);
    if (length === 'long') await frame.locator('main[data-oc-scrolling]').waitFor({ state: 'attached' });
    await atFrame(frame);
    const scrolling = await measure(frame);
    if (length === 'long') assert.ok(scrolling.scroll > 0 && scrolling.marker, 'real wheel scroll activates the SDK marker');
    await atFooter();
    const exited = await measure(frame);
    assert.equal(exited.hover, false, 'cross into fixed footer before leaving the iframe');
    await outside.click();
    const blurred = await measure(frame);
    assert.equal(blurred.focus, false, 'host button takes focus from iframe');
    await frame.locator('main:not([data-oc-scrolling])').waitFor({ state: 'attached' });
    const settled = await measure(frame);
    assert.equal(settled.marker, false);
    const stages = { rest, hover, scrolling, exited, blurred, settled };
    for (const [name, stage] of Object.entries(stages)) {
      assert.deepEqual(stage.geom, rest.geom, `${width}/${locale}/${length}/${name}: no horizontal layout drift`);
      assert.equal(stage.css, 'auto', `${width}/${locale}/${length}/${name}: SDK pseudo scrollbar remains in use`);
    }
    if (shots && width === 320 && length === 'long') {
      await frame.locator('main').evaluate((el) => { el.scrollTop = 0; });
      await iframe.screenshot({ path: join(evidence, `panel-320-${locale}-iframe-gutter.png`), animations: 'disabled' });
    }
    rows.push({ width, locale, length, height, stages });
    await page.close();
  }
  if (shots) await writeFile(join(evidence, 'panel-iframe-gutter.json'), `${JSON.stringify(rows, null, 2)}\n`);
  mark(`PASS SDK guest iframe: ${rows.length} cases × 6 stages; 6 px reserved on both short and long pages; 0 px horizontal drift`);
}

try {
  if (shots) await mkdir(evidence, { recursive: true });
  if (!guttersOnly) {
    if (!interactionsOnly && !sandboxOnly) { await layouts(); await wideGrid(); await states(); await signatures(); }
    if (!sandboxOnly) {
      await previewAndLibrary();
      for (const locale of locales) { await namedPreviewNotice(locale); await reinstallRecovery(locale); }
      await passiveBoundaries();
      await interactions();
    }
    await sandboxForms();
  }
  if (guttersOnly && !process.env.UI_OC_SOURCE) throw new Error('Set UI_OC_SOURCE to an OpenChamber source checkout.');
  if (process.env.UI_OC_SOURCE) await gutters(process.env.UI_OC_SOURCE);
  assert.deepEqual(pageErrors, [], 'no uncaught browser error or external network request');
  mark(`PASS browser errors/network: 0; Chromium ${chromium.version()}; test JS ${fixture.fixtureBytes} B + real core fixture ${fixture.realBytes} B; CSS ${fixture.cssBytes} B`);
  if (shots) console.log(`Screens and geometry: ${evidence}`);
} finally {
  await chromium.close();
  await fixture.close();
  await rm(temporary, { recursive: true, force: true });
}
