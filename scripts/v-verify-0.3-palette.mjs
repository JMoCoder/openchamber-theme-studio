// Core palette coverage. Actual output is computed on the native root after
// real clicks; reference colors come from each shipped preset and the engine.
import assert from 'node:assert/strict';
import {
  act, addFromSettings, assetsMatch, candidate, curated, editions, expectPaint, mount, nativeMode,
  nativeTheme, rootPaint, run, shortlist, show, styled, variant,
} from './v-verify-0.3-fixture.mjs';

const [instance, mode] = process.argv.slice(2);
const pairings = ['afterglow', 'hojicha'];
function ratio(a, b) {
  const luma = hex => {
    if (!/^#[\da-f]{6}$/iu.test(hex ?? '')) return NaN;
    const px = hex.slice(1).match(/../gu).map(n => Number.parseInt(n, 16) / 255)
      .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return [.2126, .7152, .0722].reduce((sum, w, i) => sum + px[i] * w, 0);
  };
  const lum = [luma(a), luma(b)].sort((x, y) => y - x);
  return +( (lum[0] + .05) / (lum[1] + .05) ).toFixed(2);
}

if (mode === 'thermal-visual') {
  await run(instance, mode, async ctx => {
    const { page } = ctx;
    await nativeMode(page, 'dark', 'light');
    await nativeTheme(page, 'dark', 'openchamber-dark');
    await addFromSettings(ctx, '0.3.0');
    await mount(ctx);
    await assetsMatch(ctx, candidate);
    if (await variant(ctx, 'dark').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'dark').click();
    for (const preset of pairings) {
      await show(ctx, 'theme');
      await expectPaint(ctx, { label: `${preset} default dark`, mode: 'dark', edit: 'dark',
        trigger: () => act(ctx, 'load-preset', preset).click(), def: curated(preset, 'dark') });
      await show(ctx, 'style');
      const { data, done } = await expectPaint(ctx, { label: `${preset} dark thermal`, mode: 'dark', edit: 'dark',
        trigger: () => act(ctx, 'style', 'thermal-ramp').click(), def: styled('thermal-ramp', curated(preset, 'dark')), broad: true });
      const screenshot = await ctx.shot(`${preset}-thermal-dark`);
      ctx.record('dark-violet-visual', { preset, wholeWindow: data.after, screenshot,
        banner: (await rootPaint(page)).scheme, controls: (await ctx.frame.locator('.style-settings').innerText()).replace(/\n/gu, ' / '),
        pageContrast: ratio(done.values['--surface-foreground'], done.values['--surface-background']) });
    }
  });
} else await run(instance, 'palette', async ctx => {
  const results = [];
  await nativeMode(ctx.page, 'light', 'light');
  await nativeTheme(ctx.page, 'light', 'openchamber-light');
  await addFromSettings(ctx, '0.3.0');
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  // Keep one actual mode while testing the full color-combination grid. The
  // cross-mode matrix separately verifies native appearance modes.
  for (const [n, preset] of pairings.entries()) {
    for (const [m, edit] of editions.entries()) {
      if (await variant(ctx, edit).getAttribute('aria-pressed') !== 'true') {
        if (results.length === 0) await variant(ctx, edit).click();
        else await expectPaint(ctx, {
          label: `切编辑版到${edit}`, mode: 'light', edit,
          trigger: () => variant(ctx, edit).click(),
          def: styled(shortlist.at(-1), curated(pairings[n === 1 && m === 0 ? 0 : n], edit)),
          mustChange: false,
        });
      }
      await show(ctx, 'theme');
      await expectPaint(ctx, { label: `${preset}/${edit}/base`, mode: 'light', edit,
        trigger: () => act(ctx, 'load-preset', preset).click(), def: curated(preset, edit), mustChange: false,
      });
      await show(ctx, 'style');
      for (const [i, id] of shortlist.entries()) {
        const label = `${preset}-${edit}-${id}`;
        try {
          const { data, done } = await expectPaint(ctx, { label, mode: 'light', edit,
            trigger: () => act(ctx, 'style', id).click(),
            def: styled(id, curated(preset, edit)), broad: true,
            project: p => p?.style[edit]?.id === id,
          });
          const c = done.values;
          const scores = {
            page: ratio(c['--surface-foreground'], c['--surface-background']),
            sidebar: ratio(c['--sidebar-foreground'], c['--sidebar-background']),
            inactiveText: ratio(c['--surface-muted-foreground'], c['--surface-muted']),
            primaryButton: ratio(c['--primary-foreground'], c['--primary-base']),
            codeComment: ratio(c['--syntax-comment'], c['--syntax-background']),
          };
          const screenshot = i % 4 === n * 2 + m ? await ctx.shot(label) : null;
          results.push({ label, ok: true, colors: data.expandedChannels, score: scores, screenshot });
        } catch (error) {
          results.push({ label, ok: false, why: error.message, host: await rootPaint(ctx.page),
            screenshot: await ctx.shot(`${label}-failure`) });
        }
      }
    }
  }
  ctx.record('engine-and-visual', { results });
  assert.equal(results.length, 32);
  assert.ok(results.every(r => r.ok), 'every engine palette must reach the native window');
});
