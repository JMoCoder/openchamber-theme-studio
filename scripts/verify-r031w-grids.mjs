// Wide acceptance for the frozen package: resize via the native splitter.
// No injected CSS, forced iframe dimensions, or added cards.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { act, blob, evidence, language, show, snapFiles } from './v-verify-0.3-fixture.mjs';

const rightPane = '[data-context-zone="right"][data-context-panel-open="true"]';
const grids = {
  presets: '.preset-cards',
  builtins: '.builtin-cards',
  styles: '.style-grid',
};
const round = (value) => Number(value.toFixed(3));
const equalWidths = (a, b) => Math.abs(a - b) <= 1;

export async function verifyWideGrids(ctx, { name, fixture, fixtureFiles, served, nativeHostVersion }) {
  const { page, state } = ctx;
  const frame = page.locator('iframe[title="Theme Studio"]');
  const splitter = page.locator(`${rightPane} > [role="separator"]`);
  const before = snapFiles(ctx);
  const report = {
    host: state.mode, nativeHostVersion, fixture, fixtureFiles, served, instance: name,
    isolated: { pid: state.pid, data: state.openchamberData, endpoint: state.url },
    sizes: [], screenshots: [], issues: [],
  };
  const output = join(evidence, `${name}-grids.json`);
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const width = async () => (await frame.boundingBox()).width;
  const settled = () => page.locator(rightPane).evaluate(async panel => {
    // Native sidebar transitions continue after changing the window size.
    // Read the next handle position only once the rendered boxes have settled.
    await new Promise((resolve, reject) => {
      let previous, since;
      const started = performance.now();
      const tick = now => {
        const frame = panel.querySelector('iframe[title="Theme Studio"]');
        const nodes = [panel, panel.querySelector('[data-zone-card]'),
          panel.querySelector('[role="separator"]'), frame].filter(Boolean);
        const measure = nodes.map(node => {
          const box = node.getBoundingClientRect();
          return `${box.x},${box.y},${box.width},${box.height}`;
        }).join('|');
        if (!frame || measure !== previous ||
            nodes.some(node => node.getAnimations().some(animation => animation.playState === 'running'))) {
          previous = measure;
          since = now;
        }
        if (now - since >= 110) resolve();
        else if (now - started > 5000) reject(new Error('native sidebar layout did not settle'));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  const check = (ok, message) => { if (!ok) report.issues.push(message); };
  const layout = () => page.locator(rightPane).evaluate(el => {
    const rect = (node) => {
      const r = node?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    const workspace = el.closest('[data-workspace-row]');
    return {
      viewport: [innerWidth, innerHeight], outerWindow: [outerWidth, outerHeight],
      screen: [screen.width, screen.height], dpr: devicePixelRatio,
      workspace: rect(workspace), leftZone: rect(workspace?.querySelector('[data-context-zone="left"][data-context-panel-open="true"]')),
      zone: rect(el), zoneSize: Number(el.dataset.zoneSize), frame: rect(el.querySelector('iframe[title="Theme Studio"]')),
    };
  });
  async function drag(destination) {
    await settled();
    const grip = await splitter.boundingBox();
    assert.ok(grip, 'native right separator is visible');
    const x = grip.x + grip.width / 2, y = grip.y + Math.min(64, grip.height / 2);
    const end = typeof destination === 'function' ? destination(x) : destination;
    assert.ok(await splitter.evaluate((el, point) =>
      el.contains(document.elementFromPoint(...point)), [x, y]), 'pointer lands on the native right separator');
    await page.mouse.move(x, y);
    await page.mouse.down();
    try {
      // The host installs its window-level drag listener after pointerdown.
      await frames();
      await page.mouse.move(end, y, { steps: 14 });
    } finally { await page.mouse.up(); }
    await settled();
    return { from: [x, y], to: [end, y], width: await width() };
  }
  async function resize(px) {
    for (let i = 0; i < 4; ++i) {
      const measured = await width();
      if (Math.abs(measured - px) < 0.01) break;
      await drag(x => x + measured - px);
    }
    const measured = await width();
    assert.ok(equalWidths(px, measured), `native splitter: requested ${px}, measured ${measured}`);
    return measured;
  }
  async function expand(action, expanded) {
    const toggle = act(ctx, action);
    if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click();
    // The extension replaces the button on its next animation frame.
    await ctx.frame.locator(`[data-act="${action}"][aria-expanded="${expanded}"]`).waitFor();
  }
  async function measure(key, size, lang) {
    const grid = ctx.frame.locator(grids[key]);
    await grid.waitFor();
    const data = await grid.evaluate(async el => {
      await document.fonts.ready;
      const snap = (n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const overflows = (n) => n.scrollWidth > n.clientWidth;
      const view = document.documentElement;
      const main = el.closest('.studio-main');
      const studio = el.closest('.studio');
      const css = getComputedStyle(el);
      const gridRect = snap(el), mainRect = snap(main);
      const cards = [...el.children].map(card => {
        const label = card.querySelector('.theme-card-name');
        const box = snap(card), nameBox = snap(label), caption = snap(label.parentElement);
        const range = document.createRange();
        range.selectNodeContents(label);
        const lines = [...range.getClientRects()].filter(r => r.width > 0);
        const within = (line, bound) => line.left >= bound.left - 0.5 && line.right <= bound.right + 0.5 &&
          line.top >= bound.top - 0.5 && line.bottom <= bound.bottom + 0.5;
        return {
          id: card.dataset.id, name: label.textContent.trim(), x: box.left, y: box.top, bottom: box.bottom, width: box.width,
          lines: new Set(lines.map(r => r.top)).size, labelWidth: nameBox.width,
          textLineMax: Math.max(0, ...lines.map(r => r.width)),
          nameClipped: !lines.length || overflows(label) || lines.some(line => !within(line, caption) || !within(line, box)),
          overflow: overflows(card) || box.left < gridRect.left - 0.5 || box.right > gridRect.right + 0.5,
        };
      });
      return {
        iframe: [view.clientWidth, view.clientHeight], containerWidth: snap(studio).width,
        columns: css.gridTemplateColumns.split(/\s+/u).length, tracks: css.gridTemplateColumns,
        paintedColumns: new Set(cards.map(card => card.x)).size,
        minCard: Math.min(...cards.map(card => card.width)), maxCard: Math.max(...cards.map(card => card.width)),
        gap: css.columnGap, gridRect, mainRect,
        overflow: { document: overflows(view), body: overflows(document.body), studio: overflows(studio),
          main: overflows(main), grid: overflows(el), cards: cards.filter(card => card.overflow).map(card => card.name) },
        clippedNames: cards.filter(card => card.nameClipped).map(card => card.name), cards,
      };
    });
    const label = `${lang}/${size}/${key} (${data.containerWidth}px)`;
    assert.ok(data.cards.length > 0, `${label}: missing cards`);
    check(equalWidths(data.iframe[0], size), `${label}: iframe and native bounds disagree`);
    const w = data.containerWidth;
    const expected = w >= 1031 ? Math.min(16, 5 + Math.floor((w - 1031) / 248)) : w < 382 ? 2 : w < 552 ? 3 : null;
    if (expected !== null) check(data.columns === expected, `${label}: expected ${expected} columns, got ${data.columns}`);
    check(data.paintedColumns === data.columns, `${label}: painted columns do not match the grid`);
    check(data.maxCard <= 240, `${label}: card width ${data.maxCard} > 240`);
    check(!Object.entries(data.overflow).some(([key, value]) => key === 'cards' ? value.length : value),
      `${label}: horizontal overflow ${JSON.stringify(data.overflow)}`);
    check(!data.clippedNames.length, `${label}: clipped names ${data.clippedNames.join(', ')}`);
    return data;
  }
  async function capture(pageName, actual, data) {
    const visible = Object.fromEntries(Object.entries(data).map(([key, grid]) => {
      const cards = grid.cards.filter(card => card.y >= grid.mainRect.top - 0.5 && card.bottom <= grid.mainRect.bottom + 0.5);
      check(new Set(cards.map(card => card.x)).size === grid.columns,
        `${pageName} screenshot: ${key} does not show a full row`);
      return [key, { fullCardsInViewport: cards.length, total: grid.cards.length }];
    }));
    const path = join(evidence, `${name}-widest-${pageName}-zh.png`);
    const bytes = await frame.screenshot({ path, animations: 'disabled' });
    report.screenshots.push({ page: pageName, actual, locale: 'zh', path: basename(path), sha256: blob(bytes), visible });
  }
  try {
    if (state.mode === 'web') await page.setViewportSize({ width: 2400, height: 1440 });
    await splitter.waitFor();
    await settled();
    const start = await layout();
    if (state.mode === 'desktop') {
      assert.equal(start.screen.join('x'), state.screen, 'real isolated GNOME monitor dimensions');
      assert.equal(start.viewport[0], start.screen[0], 'the isolated Electron window fills its native monitor');
    }
    assert.ok(start.viewport[0] >= 2000, 'a wide host viewport is required');
    const limitDrags = [await drag(80), await drag(2), await drag(1)];
    const maximum = await layout();
    report.maximum = { start, drags: limitDrags, ...maximum };
    const max = maximum.frame.width;
    assert.ok(max > 1280, 'maximum must exceed the separately measured 1280px');
    // The first pull can move the native work-status rail away from the panel.
    // Both subsequent pulls must saturate at the same width and the chat floor.
    check(limitDrags.slice(1).every(drag => equalWidths(drag.width, max)),
      'further native drags did not reach a stable maximum');
    const remainingWorkspace = maximum.workspace.width - (maximum.leftZone?.width ?? 0) - maximum.zone.width;
    report.maximum.remainingWorkspace = remainingWorkspace;
    check(Math.abs(remainingWorkspace - 320) <= 2, `right sidebar did not hit the host's 320px chat floor (${remainingWorkspace}px remain)`);
    // Spot-check exact breakpoints and the preceding widths, which have the
    // widest cards for a given track count. 1280 is the requested wide sample.
    const edges = [1030, 1278, 1279, 1526, 1527, 1774, 1775, 2022, 2023, 2270, 2271].filter(w => w < max);
    const cases = [320, 420, 1031, ...edges, 1280].sort((a, b) => a - b);
    for (const lang of ['zh', 'en']) {
      if (await ctx.frame.locator('.studio').getAttribute('data-locale') !== lang) await language(ctx, lang);
      await expand('toggle-preview', false);
      await ctx.frame.locator('#studio-preview-frame').waitFor({ state: 'hidden' });
      report.miniPreviewCollapsed = true;
      for (const requested of [...cases, 'maximum']) {
        let actual;
        if (requested === 'maximum') {
          actual = (await drag(1)).width;
          check(equalWidths(actual, max), 'maximum changed between measurements');
        } else actual = await resize(requested);
        const row = { requested, actual, lang, grids: {} };
        report.sizes.push(row);
        await show(ctx, 'theme');
        await expand('toggle-builtins', true);
        const main = ctx.frame.locator('.studio-main');
        await main.evaluate(el => { el.scrollTop = 0; });
        await frames();
        row.grids.presets = await measure('presets', actual, lang);
        row.grids.builtins = await measure('builtins', actual, lang);
        if (requested === 'maximum' && lang === 'zh') {
          assert.match(await ctx.frame.locator('.theme-page').innerText(), /工坊精选.*内置主题/su);
          await capture('theme', actual, { presets: row.grids.presets, builtins: row.grids.builtins });
        }
        await show(ctx, 'style');
        await ctx.frame.locator(grids.styles).waitFor();
        await main.evaluate(el => { el.scrollTop = 0; });
        await frames();
        row.grids.styles = await measure('styles', actual, lang);
        if (requested === 'maximum' && lang === 'zh') await capture('style', actual, { styles: row.grids.styles });
        if (actual >= 1031) check(new Set(Object.values(row.grids).map(grid => grid.columns)).size === 1,
          `${lang}/${actual}px: the three grids have unequal column counts`);
      }
    }
    assert.deepEqual(snapFiles(ctx), before, 'measurements, tabs and language did not alter any theme file');
    report.themesUnchanged = true;
    assert.deepEqual(report.issues, []);
    report.ok = true;
    console.log(`${name}: native sidebar ${round(max)}px maximum; ${report.sizes.length} bilingual grid samples`);
  } catch (error) {
    report.ok = false;
    report.error = (error.stack ?? String(error)).replace(/\/api\/guest-files\/[^/\s"']+/gu, '/api/guest-files/[fixture-asset-grant]');
    throw error;
  } finally {
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
}
