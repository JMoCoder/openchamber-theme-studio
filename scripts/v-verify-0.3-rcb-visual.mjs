// Check the specific rc03 user-visible visual counterexamples in the
// actual rc03b window; observe DOM/files only, not the style engine.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, candidate, curated, eventually, expectPaint, historicalSurface, load,
  mount, nativeMode, nativeTheme, paintSummary, rootPaint, run, show, slotFile, snapFiles, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance] = process.argv.slice(2);
assert.equal(instance, 'v03b-dvisual');
const selectors = { slider: '.style-settings input[data-knob=strength]', text: '.style-settings .range-label > span',
  controls: '.style-settings', option: '.style-settings select[data-change=style-option]', toast: '.studio-toast:not([hidden])' };

async function resize(ctx, requested) {
  const p = ctx.page.locator('iframe[title="Theme Studio"]');
  const divider = ctx.page.locator('[data-context-zone=right][data-context-panel-open=true] > [role=separator]');
  for (let i = 0; i < 4; i++) {
    const box = await p.boundingBox();
    if (Math.abs(box.width - requested) < 1.5) return box.width;
    const s = await divider.boundingBox();
    const x = s.x + s.width / 2, y = s.y + 55;
    await ctx.page.mouse.move(x, y);
    await ctx.page.mouse.down();
    await ctx.page.mouse.move(x + box.width - requested, y, { steps: 12 });
    await ctx.page.mouse.up();
    await delay(150);
  }
  throw new Error(`Requested iframe ${requested}px, measured ${(await p.boundingBox()).width}px`);
}
async function actualStyle(ctx, mode, id, strength, option) {
  const before = await load(slotFile(ctx, mode));
  assert.ok(before);
  return await eventually(async () => {
    const d = load(slotFile(ctx, mode));
    const root = await rootPaint(ctx.page);
    const s = d?.themeStudio?.project?.style?.[mode];
    return s?.id === id && Math.abs(s.strength - strength) < .00001 &&
      (option === undefined || Object.values(s.options).includes(option)) && root.mode === mode &&
      root.values['--surface-background'] === d.colors.surface.background &&
      root.values['--surface-muted'] === d.colors.surface.muted &&
      root.values['--primary-base'] === d.colors.primary.base && { root, style: s, d };
  }, `${mode} real host draws ${id} ${strength}${option ? ` ${option}` : ''}`, 16_000);
}
const samples = actual => Object.fromEntries([
  '--surface-background', '--surface-muted', '--surface-foreground', '--surface-muted-foreground',
  '--surface-elevated', '--primary-base', '--primary-foreground', '--interactive-active', '--syntax-background',
  '--markdown-link',
].map(k => [k, actual.root.values[k]]));
const layout = ctx => ctx.frame.locator('body').evaluate((body, q) => {
  const rect = el => el?.getBoundingClientRect().toJSON() ?? null;
  const label = body.querySelector(q.text), slider = body.querySelector(q.slider), toast = body.querySelector(q.toast);
  const controls = body.querySelector(q.controls), option = body.querySelector(q.option);
  const range = label.ownerDocument.createRange(); range.selectNodeContents(label);
  const textRects = [...range.getClientRects()].map(r => r.toJSON());
  const css = getComputedStyle(label);
  const ancestor = label.parentElement.parentElement.getBoundingClientRect();
  const allGlyphRowsInRange = textRects.every(r => r.left >= ancestor.left - .1 && r.right <= ancestor.right + .1 &&
    r.top >= ancestor.top - .1 && r.bottom <= ancestor.bottom + .1);
  const overlap = (a, b) => a && b ?
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
  return { width: innerWidth, text: label.innerText, textRects, label: rect(label),
    row: rect(label.parentElement), slider: rect(slider), option: rect(option), controls: rect(controls), toast: rect(toast),
    overflow: css.overflow, whiteSpace: css.whiteSpace, overflowWrap: css.overflowWrap, textOverflow: css.textOverflow,
    scrollWidth: label.scrollWidth, clientWidth: label.clientWidth, allGlyphRowsInRange, toastText: toast?.innerText,
    areaToastControls: overlap(rect(controls), rect(toast)), areaToastSlider: overlap(rect(slider), rect(toast)),
    areaToastOption: overlap(rect(option), rect(toast)) };
}, selectors);

await run(instance, 'visual', async ctx => {
  const { page } = ctx;
  assert.deepEqual(snapFiles(ctx), {});
  await nativeMode(page, 'dark', 'dark');
  await nativeTheme(page, 'dark', 'openchamber-dark');
  const originalDark = await rootPaint(page), historicalDark = await historicalSurface(page);
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  const edit = async v => {
    if (await variant(ctx, v).getAttribute('aria-pressed') !== 'true') await variant(ctx, v).click();
    await eventually(async () => (await variant(ctx, v).getAttribute('aria-pressed')) === 'true', `style test ${v}`);
  };
  await edit('dark');
  for (const id of ['afterglow', 'hojicha']) {
    await show(ctx, 'theme');
    await expectPaint(ctx, { label: `${id} plain dark`, mode: 'dark', edit: 'dark',
      trigger: () => act(ctx, 'load-preset', id).click(), def: curated(id, 'dark') });
    await show(ctx, 'style');
    await act(ctx, 'style', 'thermal-ramp').click();
    const changed = await actualStyle(ctx, 'dark', 'thermal-ramp', 1);
    const r = await ctx.frame.locator(selectors.slider).inputValue();
    const opt = await ctx.frame.locator(selectors.option).locator('option:checked').innerText();
    assert.equal(r, '1');
    assert.equal(opt, 'Heat ramp');
    assert.equal(changed.d.themeStudio.project.origin.ref, id);
    assert.equal(changed.root.darkClass, true);
    await delay(950); // Avoid a transient pointer/previous-preview label.
    await ctx.shot(`${id}-thermal-dark-100`);
    ctx.record('dark-thermal-actual-window', { curated: id, actualMode: changed.root.mode,
      edit: 'dark', style: changed.style, option: opt, values: samples(changed), window: paintSummary(changed.root) });
  }
  await act(ctx, 'restore').click();
  await eventually(async () => JSON.stringify((await rootPaint(page)).values) === JSON.stringify(originalDark.values),
    'dark native restore before the light visual case');
  assert.deepEqual(await historicalSurface(page), historicalDark);
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  await mount(ctx);
  await edit('light');
  await show(ctx, 'theme');
  await expectPaint(ctx, { label: 'afterglow plain light', mode: 'light', edit: 'light',
    trigger: () => act(ctx, 'load-preset', 'afterglow').click(), def: curated('afterglow', 'light') });
  await show(ctx, 'style');
  await act(ctx, 'style', 'constructivist').click();
  await actualStyle(ctx, 'light', 'constructivist', 1);
  const slider = ctx.frame.locator(selectors.slider);
  // Keys are trusted native input. Changing to exactly .52 avoids rounding
  // or manufacturing an unrepresentative pointer position.
  const delta = 48;
  await slider.press('Home');
  const minimum = Number(await slider.getAttribute('min'));
  const step = Number(await slider.getAttribute('step'));
  const presses = Math.round((.52 - minimum) / step);
  assert.ok(Math.abs(presses - delta) < 60 && step > 0 && presses > 0 && presses < 60);
  for (let i = 0; i < presses; i++) await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '0.52');
  await actualStyle(ctx, 'light', 'constructivist', .52);
  const menu = ctx.frame.locator(selectors.option);
  await menu.press('End');
  assert.equal(await menu.inputValue(), 'leaflet');
  const adjusted = await actualStyle(ctx, 'light', 'constructivist', .52, 'leaflet');
  assert.equal(adjusted.d.themeStudio.project.origin.ref, 'afterglow');
  await delay(850);
  await ctx.shot('afterglow-light-constructivist-leaflet-52');
  ctx.record('light-constructivist-actual-window', { curated: 'afterglow', actualMode: adjusted.root.mode, edit: 'light',
    style: adjusted.style, option: await menu.locator('option:checked').innerText(), values: samples(adjusted), window: paintSummary(adjusted.root) });

  const measured = await resize(ctx, 320);
  const files = snapFiles(ctx);
  await ctx.frame.locator('.studio-menu summary').click();
  await ctx.frame.locator('.studio-menu [data-act=copy-json]').click();
  await ctx.frame.locator(selectors.toast).waitFor({ timeout: 4000 });
  const geometry = await layout(ctx);
  await ctx.shot('english-320-full-label-and-toast');
  ctx.record('narrow-full-label-and-toast', { measured, ...geometry });
  assert.equal(geometry.width, 320);
  assert.equal(geometry.text, 'Strength · Constructivist');
  assert.equal(geometry.allGlyphRowsInRange, true);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1);
  assert.equal(geometry.textOverflow, 'clip');
  assert.ok(geometry.toast?.width > 0);
  assert.deepEqual([geometry.areaToastControls, geometry.areaToastSlider, geometry.areaToastOption], [0, 0, 0]);
  assert.deepEqual(snapFiles(ctx), files);
});
