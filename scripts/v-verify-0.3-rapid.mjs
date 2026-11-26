// The native Electron locator implementation can spend >0.5s finding each
// button. Premeasure first and send a burst of real coordinate mouse input
// over CDP, so the click intervals are below the preview debounce.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, candidate, curated, eventually, expectPaint, mount, nativeMode,
  nativeTheme, rootPaint, run, show, variant,
} from './v-verify-0.3-fixture.mjs';

const [name] = process.argv.slice(2);
await run(name, 'rapid', async ctx => {
  const { page } = ctx;
  await page.setViewportSize({ width: 1360, height: 970 });
  await nativeMode(page, 'light', 'light');
  await nativeTheme(page, 'light', 'openchamber-light');
  await nativeTheme(page, 'dark', 'openchamber-dark');
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  await show(ctx, 'theme');
  const cdp = await ctx.context.newCDPSession(page);
  try {
    const burst = ['tidemark', 'wheat-vellum', 'quiet-graphite', 'blue-etch'];
    for (const [mode, pref, chosen] of [
      ['light', 'dark', 'light'], ['dark', 'light', 'dark'], ['light', 'light', 'system'], ['dark', 'dark', 'system'],
    ]) {
      await nativeMode(page, mode, pref, chosen);
      await mount(ctx);
      const edit = mode === 'light' ? 'dark' : 'light';
      if (await variant(ctx, edit).getAttribute('aria-pressed') !== 'true') await variant(ctx, edit).click();
      await eventually(async () => await variant(ctx, edit).getAttribute('aria-pressed') === 'true', `variant ${edit}`);
      // Ensure the next burst changes colors, including when entering the
      // same place through a different native appearance selection.
      await expectPaint(ctx, { label: `${chosen}/${mode} prepare`, mode, edit, def: curated('reed-shade', edit),
        trigger: () => act(ctx, 'load-preset', 'reed-shade').click(), mustChange: false });
      const commands = [];
      for (const id of burst) {
        const control = act(ctx, 'load-preset', id);
        const inView = await control.evaluate(el => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        });
        assert.ok(inView, `${id} is actually hit-testable`);
        const r = await control.boundingBox();
        const xy = { x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 };
        commands.push({ ...xy, type: 'mousePressed', buttons: 1 }, { ...xy, type: 'mouseReleased', buttons: 0 });
      }
      const last = await expectPaint(ctx, { label: `coordinate burst ${chosen}/${mode}`, mode, edit,
        def: curated(burst.at(-1), edit), project: p => p?.origin.ref === burst.at(-1),
        trigger: () => Promise.all(commands.map(x => cdp.send('Input.dispatchMouseEvent', x))).then(() => ({ sequence: burst })) });
      assert.deepEqual(last.data.trusted.map(s => s.id), burst);
      const gaps = last.data.trusted.slice(1).map((s, i) => Math.round(s.at - last.data.trusted[i].at));
      assert.ok(gaps.every(ms => ms < 250), `clicks were not rapid: ${gaps}`);
      await delay(350);
      assert.deepEqual((await rootPaint(page)).values, last.done.values, 'no late older click overrides the winner');
      ctx.record('native-coordinate-burst', { chosen, mode, edit, gaps, latencyMs: last.data.latencyMs, winner: burst.at(-1) });
    }
  } finally { await cdp.detach(); }
});
