// Measure rendered positions across the native iframe boundary. No fixture CSS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openExtension, openFixture, repo } from './dev-browser.mjs';

const [name, mode] = process.argv.slice(2);
assert.match(name ?? '', /^ts2-[a-z0-9-]{1,24}$/u);
assert.ok(['before', 'after'].includes(mode));
const app = await openFixture(name);
const { page, state } = app;
const output = join(repo, 'docs/research/evidence/interactions');
const iframe = page.locator('iframe[title="Theme Studio"]');
const separator = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role="separator"]');
const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readings = [], screenshots = [];
try {
  await mkdir(output, { recursive: true });
  assert.equal(state.defaultDataDir, true);
  assert.notEqual(new URL(state.url).port, '57123');
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openExtension(page, 'Theme Studio');
  const main = panel.locator('.studio-main');
  const dialog = panel.locator('dialog[open]');
  if (await dialog.isVisible()) await dialog.press('Escape');
  await panel.locator('[data-act="tab"][data-id="theme"]').click();
  const grid = panel.locator('.preset-cards');
  await grid.waitFor();
  async function resize(w) {
    for (let i = 0; i < 4; i++) {
      const rect = await iframe.boundingBox();
      if (Math.abs(rect.width - w) <= 2) return;
      const grip = await separator.boundingBox(), x = grip.x + grip.width / 2, y = grip.y + 32;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + rect.width - w, y, { steps: 12 }); await page.mouse.up(); await frames();
    }
    assert.ok(Math.abs((await iframe.boundingBox()).width - w) <= 2, `native splitter ${w}`);
  }
  async function sample(w, phase) {
    await frames();
    const outer = await iframe.boundingBox(), grip = await separator.boundingBox();
    const row = await main.evaluate(el => {
      const at = n => { const r = n.getBoundingClientRect(); return [r.x, r.width]; };
      const cards = [...el.querySelectorAll('.preset-cards .theme-card')];
      if (!cards.length) throw Error('no theme cards');
      const rightmost = cards.reduce((a, b) => a.getBoundingClientRect().right >= b.getBoundingClientRect().right ? a : b);
      const g = getComputedStyle(el);
      return { panelFocused: document.hasFocus(), inMain: el.matches(':hover'), overflow: el.scrollHeight > el.clientHeight,
        track: el.offsetWidth - el.clientWidth, cssWidth: g.scrollbarWidth, cssColor: g.scrollbarColor,
        xw: [at(el), at(el.querySelector('.preset-cards')), ...cards.slice(0, 3).map(at), at(document.querySelector('footer'))],
        outerCards: { last: at(cards.at(-1)), rightmost: at(rightmost) } };
    });
    readings.push({ w, phase, ...row, xw: [...row.xw, [outer.x, outer.width], [grip.x, grip.width]] });
  }
  for (const w of [320, 420, 720]) {
    await resize(w);
    const box = await main.boundingBox();
    const x = box.x + Math.min(60, box.width / 2), y = box.y + Math.min(70, box.height / 2);
    await main.focus(); await page.mouse.move(x, y); await sample(w, 'inside');
    await page.mouse.wheel(0, 180); await sample(w, 'scroll');
    // Cross into a sibling *inside* the iframe, too. In some Chromium builds a
    // direct jump to another surface leaves the previous iframe's :hover parked.
    await panel.locator('footer').hover(); await sample(w, 'over-footer');
    const hostButton = page.locator('[data-context-surface="plugin:theme-studio"]').first();
    await hostButton.hover(); await hostButton.focus();
    await panel.locator('.studio-main[data-oc-scrolling]').waitFor({ state: 'detached' });
    await sample(w, 'blurred-idle');
    if (mode === 'after') {
      await main.evaluate(el => { el.scrollTop = 0; });
      await frames();
      const image = await iframe.screenshot({ type: 'jpeg', quality: 81, animations: 'disabled' });
      const path = `sidebar-${state.mode}-${w}.jpg`;
      await writeFile(join(output, path), image);
      screenshots.push({ w, path, locale: await panel.locator('.studio').getAttribute('data-locale'),
        sha: createHash('sha256').update(image).digest('hex') });
    }
  }
  const summary = [320, 420, 720].map(w => {
    const rows = readings.filter(r => r.w === w);
    const rowsXW = rows.map(r => [...r.xw.flat(), ...r.outerCards.last, ...r.outerCards.rightmost]);
    return { w, tracks: rows.map(r => r.track),
      maxShiftPx: Math.max(...rowsXW[0].map((_, i) => Math.max(...rowsXW.map(r => r[i])) - Math.min(...rowsXW.map(r => r[i])))) };
  });
  const report = { host: state.mode, mode, readings, summary, screenshots };
  await writeFile(join(output, `gutter-${mode}-${state.mode}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (mode === 'after') {
    assert.ok(readings.some(r => r.overflow), 'exercise a scrolling page');
    assert.ok(readings.some(r => r.inMain) && readings.some(r => !r.inMain), 'pointer left the scroller');
    assert.ok(readings.some(r => r.panelFocused) && readings.some(r => !r.panelFocused), 'focus crossed the frame');
    assert.ok(summary.every(r => r.maxShiftPx <= 0.1), 'scroll, hover and focus must not move cards or the host split');
  }
} finally { await app.close(); }
