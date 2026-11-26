import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, candidate, curated, editions, eventually, expectPaint, language, liveToggle,
  mount, nativeMode, nativeTheme, other, recipe, rootPaint, run, show, snapFiles, styled, variant,
} from './v-verify-0.3-fixture.mjs';
import { STYLE_RECIPES } from '../shared/style-recipes.mjs';

const [name] = process.argv.slice(2);
const widths = [320, 420, 720];
const nextFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const splitter = page => page.locator('[data-context-zone=right][data-context-panel-open=true] > [role=separator]');
const frameNode = page => page.locator('iframe[title="Theme Studio"]');
async function width(ctx, requested) {
  for (let i = 0; i < 4; i++) {
    const panel = await frameNode(ctx.page).boundingBox();
    if (Math.abs(panel.width - requested) <= 2) return panel.width;
    const split = await splitter(ctx.page).boundingBox();
    const x = split.x + split.width / 2, y = split.y + 48;
    await ctx.page.mouse.move(x, y);
    await ctx.page.mouse.down();
    await ctx.page.mouse.move(x + panel.width - requested, y, { steps: 10 });
    await ctx.page.mouse.up();
    await nextFrames(ctx.page);
  }
  const measured = (await frameNode(ctx.page).boundingBox()).width;
  assert.ok(Math.abs(measured - requested) <= 2, `${requested}px demanded, native iframe ${measured}px`);
  return measured;
}
const main = ctx => ctx.frame.locator('.studio-main');
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 0.5
  ? Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
const state = ctx => main(ctx).evaluate(el => {
  const rect = node => node?.getBoundingClientRect().toJSON();
  return {
    main: rect(el), overflow: el.scrollHeight > el.clientHeight, scrollY: el.scrollTop,
    rail: el.offsetWidth - el.clientWidth, railCss: getComputedStyle(el, '::-webkit-scrollbar').width,
    grid: rect(el.querySelector('.style-grid')), controls: rect(el.querySelector('.style-settings')),
    cards: [...el.querySelectorAll('.style-grid .theme-card')].map(rect),
    selected: rect(el.querySelector('.style-grid .theme-card.is-selected')),
    trigger: el.querySelector('.style-grid .theme-card.is-selected')?.dataset.id,
    banners: [...el.ownerDocument.querySelectorAll('.u-banner,.studio-toast:not([hidden])')].map(rect),
    focus: document.hasFocus(), hover: el.matches(':hover'),
  };
});
async function editor(ctx, id) {
  const choice = variant(ctx, id);
  if (await choice.getAttribute('aria-pressed') !== 'true') await choice.click();
  await eventually(async () => (await choice.getAttribute('aria-pressed')) === 'true', `editing ${id}`);
}
async function choose(ctx, id) {
  const card = act(ctx, 'style', id);
  await card.click({ timeout: 3500 });
  await eventually(async () => (await card.getAttribute('aria-pressed')) === 'true', `selected ${id}`, 4000);
  await nextFrames(ctx.page);
  return state(ctx);
}
const keepByX = row => [row.main, row.grid, ...row.cards].flatMap(r => [r.x, r.width]).concat(row.grip.x, row.grip.width);
await run(name, process.env.V03_RUN_ID ?? 'style-ui', async ctx => {
  const { page } = ctx;
  await page.setViewportSize({ width: 1440, height: 970 });
  if (process.env.V03_STYLE_CONTROLS_RESUME === '1') {
    // The preceding width/locale matrix already installed and activated this
    // exact package. Remount it natively with its persisted draft and files.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await mount(ctx);
    await assetsMatch(ctx, candidate);
    await nativeMode(page, 'light', 'light');
    await editor(ctx, 'light');
    await width(ctx, 420);
    await exerciseLiveControls(ctx, 'afterglow');
    return;
  }
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await liveToggle(ctx, false);
  const files = snapFiles(ctx);
  const failures = [];
  const tapped = [];
  for (const locale of ['en', 'zh']) {
    await language(ctx, locale);
    for (const edit of editions) {
      const actualHost = await nativeMode(page, edit, edit);
      await editor(ctx, edit);
      await show(ctx, 'style');
      assert.equal(await ctx.frame.locator('[data-act=style]').count(), 18);
      for (const w of widths) {
        const actualWidth = await width(ctx, w);
        const rects = [], overlaps = [];
        for (const card of STYLE_RECIPES) {
          try {
            const st = await choose(ctx, card.id);
            assert.equal(st.trigger, card.id);
            assert.ok(st.controls && st.selected, 'placement geometry should exist');
            const cover = overlap(st.controls, st.selected);
            const bannerCover = Math.max(0, ...st.banners.map(b => overlap(st.controls, b)));
            tapped.push([locale, edit, w, card.id]);
            if (cover > 0.5 || bannerCover > 0.5) overlaps.push({
              style: card.id, coverPx: cover, bannerCover, selected: st.selected, controls: st.controls, scrollY: st.scrollY,
            });
          } catch (e) { failures.push({ locale, edit, w, style: card.id, interaction: e.message }); }
        }
        const record = async () => {
          await nextFrames(page);
          rects.push({ ...await state(ctx), grip: await splitter(page).boundingBox() });
        };
        await main(ctx).hover({ position: { x: 24, y: 28 } });
        await record();
        await page.mouse.wheel(0, -164);
        await delay(120);
        await record();
        await ctx.frame.locator('footer').hover();
        await record();
        await page.locator('[data-context-surface="plugin:theme-studio"]').first().hover();
        await delay(540);
        await record();
        const xs = rects.map(keepByX);
        const shifts = xs[0].map((_, i) => Math.max(...xs.map(a => a[i])) - Math.min(...xs.map(a => a[i])));
        const maxShift = Math.max(...shifts);
        const geometry = { locale, edit, actualHost, w, actualWidth, maxShift,
          rail: rects.map(r => r.rail), railCss: rects.map(r => r.railCss),
          flows: rects.map(r => ({ scrollY: r.scrollY, overflow: r.overflow, hover: r.hover, focus: r.focus })),
          overlaps, positions: rects.map(keepByX) };
        if (overlaps.length || maxShift > .1 || rects.some(r => r.rail !== 6)) failures.push(geometry);
        ctx.record('style-geometry', geometry);
        if ((locale === 'en' && edit === 'dark' && w === 320) ||
            (locale === 'zh' && edit === 'light' && w === 420) ||
            (locale === 'zh' && edit === 'dark' && w === 720)) await ctx.shot(`${locale}-${edit}-${w}`);
      }
    }
  }
  assert.deepEqual(snapFiles(ctx), files, '12 offline UI surfaces must not write');
  ctx.record('style-geometry-summary', { tapped, problems: failures });
  await language(ctx, 'en');
  await nativeMode(page, 'light', 'light');
  await editor(ctx, 'light');
  await width(ctx, 420);
  // Start from a focused navigation tab; send actual keyboard inputs to the
  // tab and navigate to a recipe solely by tab order for the recipe selection.
  await act(ctx, 'tab', 'theme').click();
  await page.keyboard.press('ArrowRight');
  await eventually(async () => (await act(ctx, 'tab', 'style').getAttribute('aria-selected')) === 'true', 'ArrowRight activates Style');
  const keys = ['ArrowRight'];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    keys.push('Tab');
    const focused = await ctx.frame.locator('body').evaluate(() => document.activeElement?.dataset?.id);
    if (focused === 'constructivist') break;
  }
  const target = ctx.frame.locator(':focus').filter({ visible: true });
  assert.equal(await target.getAttribute('data-id'), 'constructivist');
  await page.keyboard.press('Enter');
  await eventually(async () => (await act(ctx, 'style', 'constructivist').getAttribute('aria-pressed')) === 'true', 'Enter applied Constructivist');
  keys.push('Enter');
  const menu = ctx.frame.locator('.studio-menu');
  await menu.locator('summary').click();
  await page.keyboard.press('Escape');
  await eventually(async () => await menu.getAttribute('open') === null, 'Escape closes actions');
  keys.push('Escape');
  ctx.record('keyboard', { keys, focused: await ctx.frame.locator(':focus').getAttribute('data-focus'), style: 'constructivist' });

  await liveToggle(ctx, true);
  await nextFrames(page);
  assert.deepEqual(snapFiles(ctx), files, 'enabling preview does not replay offline changes');
  await exerciseLiveControls(ctx, 'hojicha');
  ctx.record('style-ui-summary', { tapped, problems: failures });
  assert.equal(tapped.length, 204);
  assert.deepEqual(failures.map(x => [x.locale, x.edit, x.w, x.style, x.overlaps?.length, x.maxShift]), []);
});
async function exerciseLiveControls(ctx, preset) {
  const { page } = ctx;
  await show(ctx, 'theme');
  const base = curated(preset, 'light');
  await expectPaint(ctx, { label: 'style editor base', mode: 'light', edit: 'light',
    trigger: () => act(ctx, 'load-preset', preset).click(), def: base });
  await show(ctx, 'style');
  const id = 'constructivist';
  await expectPaint(ctx, { label: 'style editor select', mode: 'light', edit: 'light',
    trigger: () => act(ctx, 'style', id).click(), def: styled(id, base) });
  const slider = ctx.frame.locator('input[data-knob=strength]');
  const cursor = await slider.boundingBox();
  await page.mouse.move(cursor.x + cursor.width - 8, cursor.y + cursor.height / 2);
  await page.mouse.down();
  await page.mouse.move(cursor.x + cursor.width * .53, cursor.y + cursor.height / 2, { steps: 12 });
  // Read actual pointer-derived value before release; no slider injection.
  const strength = Number(await slider.inputValue());
  assert.ok(strength > .35 && strength < .65);
  await expectPaint(ctx, { label: 'pointer-drag strength', mode: 'light', edit: 'light',
    trigger: () => page.mouse.up(), def: styled(id, base, { strength }) });
  const changedStrength = +(strength - .01).toFixed(2);
  await expectPaint(ctx, { label: 'arrow key on strength', mode: 'light', edit: 'light',
    trigger: () => slider.press('ArrowLeft'), def: styled(id, base, { strength: changedStrength }) });
  const opt = recipe(id).options[0];
  const select = ctx.frame.locator(`select[data-change=style-option][data-id="${opt.key}"]`);
  const choices = await select.locator('option').evaluateAll(items => items.map(o => o.value));
  const next = choices.find(x => x !== opt.default);
  await expectPaint(ctx, { label: `keyboard change ${opt.key}`, mode: 'light', edit: 'light', def: styled(id, base, {
    strength: changedStrength, [opt.key]: next,
  }), project: p => p?.style.light.options[opt.key] === next, trigger: async () => {
    await select.press('Home');
    for (let i = 0; i < choices.indexOf(next); i++) await select.press('ArrowDown');
    assert.equal(await select.inputValue(), next);
  } });
  await width(ctx, 320);
  const menu = ctx.frame.locator('.studio-menu');
  await menu.locator('summary').click();
  await menu.locator('[data-act=copy-json]').click();
  const toast = ctx.frame.locator('.studio-toast:not([hidden])');
  if (await toast.waitFor({ timeout: 2400 }).then(() => true, () => false)) {
    const st = await state(ctx);
    const overlapPx = Math.max(...st.banners.map(b => overlap(st.controls, b)));
    ctx.record('transient-banner-vs-style-controls', { overlapPx, shown: await toast.innerText(), strength: changedStrength });
    await ctx.shot('style-toast');
    assert.equal(overlapPx, 0);
  } else ctx.record('transient-banner-vs-style-controls', { notObserved: true });
  const disk = snapFiles(ctx), overlay = await rootPaint(page);
  await liveToggle(ctx, false);
  await choose(ctx, 'chalkboard');
  await delay(3200);
  assert.deepEqual(snapFiles(ctx), disk, 'with preview off, a host that was previously painting does not get a write');
  assert.deepEqual((await rootPaint(page)).values, overlay.values);
  ctx.record('preview-off-from-working-live', { disk, status: await ctx.frame.locator('.connection').innerText() });
}
