// V matrix: for each host, set actual appearance in native settings, then
// exercise both plugin variants. The palette oracle is the configured input
// plus the reference engine, not the plugin's written file or status label.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, addFromSettings, assetsMatch, builtin, candidate, curated, defaults, editions, eventually, expectPaint,
  identical, mount, nativeMode, nativeTheme, other, painted, paintSummary, restore, rootPaint, run, shortlist,
  show, snapFiles, styled, variant, cssOf, load, root,
} from './v-verify-0.3-fixture.mjs';
import { join } from 'node:path';

const [instance, ...requested] = process.argv.slice(2);
const cases = [
  ['light', 'dark', 'light'],
  ['dark', 'light', 'dark'],
  ['system-light', 'light', 'light'],
  ['system-dark', 'dark', 'dark'],
].filter(([id]) => requested.length === 0 || requested.includes(id));
const workshop = load(join(root, 'presets/index.json')).presets.map(p => p.slug);
assert.equal(workshop.length, 11);

await run(instance, process.env.V03_RUN_ID ?? 'matrix', async ctx => {
  const resume = process.env.V03_MATRIX_RESUME === '1';
  if (!resume) {
    assert.deepEqual(snapFiles(ctx), {}, 'fresh candidate fixture');
    await nativeMode(ctx.page, 'light', 'light');
    await nativeTheme(ctx.page, 'light', 'openchamber-light');
    await nativeTheme(ctx.page, 'dark', 'openchamber-dark');
    await addFromSettings(ctx, '0.3.0');
  }
  await mount(ctx);
  await assetsMatch(ctx, candidate);
  if (!resume) assert.deepEqual(snapFiles(ctx), {}, 'native addition & opening must not create theme files');
  const failures = [];
  const quantile = (items, n) => items[Math.max(0, Math.ceil(n * items.length) - 1)] ?? null;

  for (const [id, media, mode] of cases) {
    const caseIndex = ctx.report.steps.length;
    const preMode = snapFiles(ctx);
    const native = await nativeMode(ctx.page, mode, media, id.startsWith('system-') ? 'system' : id);
    const baseline = await eventually(async () => {
      const current = await rootPaint(ctx.page);
      return current.mode === mode && painted(current, cssOf(defaults(mode))) && current;
    }, `pre-preview OpenChamber ${id}`);
    await mount(ctx);
    assert.deepEqual(snapFiles(ctx), preMode, 'setting actual window mode and opening panel is passive');
    ctx.record('native-case', { case: id, native, root: baseline.values });
    const from = other(mode);
    const editTo = async v => {
      const toggle = variant(ctx, v);
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      await eventually(async () => (await toggle.getAttribute('aria-pressed')) === 'true', `editor ${v} button is pressed`);
    };
    let caseIssue = null;
    try {
      await editTo(from);
      await delay(480);
      assert.deepEqual(snapFiles(ctx), preMode, `${id}: inactive preview must not write merely switching variant`);
      for (const edit of [from, mode]) {
        const prefix = `${id} / ${edit}`;
        const pick = (action, card, def, project) => expectPaint(ctx, {
          label: `${prefix} / ${card ?? action}`, mode, edit, def, project,
          trigger: () => act(ctx, action, card).click(),
        });
        await show(ctx, 'theme');
        // Use the reported actions first before broadening to all presets.
        await pick('load-preset', 'tidemark', curated('tidemark', edit), p => p?.origin.ref === 'tidemark');
        await pick('load-default', undefined, defaults(edit), p => p?.origin.kind === 'default');
        for (const card of ['afterglow', 'hojicha', ...workshop.filter(p => !['tidemark', 'afterglow', 'hojicha'].includes(p))]) {
          await pick('load-preset', card, curated(card, edit), p => p?.origin.ref === card);
        }
        if (!await ctx.frame.locator('.builtin-cards').isVisible()) await act(ctx, 'toggle-builtins').click();
        for (const card of ['everforest', 'flexoki']) {
          assert.ok(builtin(card, edit), `${card}-${edit} fixture input`);
          await pick('load-builtin', card, builtin(card, edit), p => p?.origin.kind === 'builtin');
        }
        await show(ctx, 'style');
        for (const style of shortlist) {
          await pick('style', style, styled(style, builtin('flexoki', edit)), p => p?.style[edit].id === style);
        }
        if (edit === from) {
          await ctx.shot(`${id}-opposite-variant`);
          await expectPaint(ctx, { label: `${id} / switch active preview to ${mode}`, mode, edit: mode,
            def: styled(shortlist.at(-1), builtin('flexoki', mode)),
            trigger: () => variant(ctx, mode).click() });
        }
      }
      await show(ctx, 'theme');
      const burst = ['hojicha', 'tidemark', 'afterglow', 'blue-etch'];
      const result = await expectPaint(ctx, { label: `${id} / rapid clicks → blue-etch`, mode, edit: mode,
        def: curated(burst.at(-1), mode), project: p => p?.origin.ref === burst.at(-1), trigger: async () => {
          for (const id of burst) await act(ctx, 'load-preset', id).click();
          return { sequence: burst };
        } });
      assert.deepEqual(result.data.trusted.map(c => c.id), burst, 'trusted browser clicks, in order');
      await delay(650);
      assert.deepEqual((await rootPaint(ctx.page)).values, result.done.values, 'last selection stays applied');
    } catch (error) {
      caseIssue = error.message;
      failures.push({ case: id, error: caseIssue });
      await ctx.shot(`${id}-mismatch`);
      ctx.record('matrix-case-failed', { case: id, error: caseIssue });
      if (!process.env.V03_CONTINUE_AFTER_FAILURE) throw error;
    } finally {
      const measurements = ctx.report.steps.slice(caseIndex).filter(s => s.stage === 'paint');
      const ms = measurements.map(s => s.latencyMs).filter(x => x !== null).sort((a, b) => a - b);
      ctx.record('timings', {
        case: id, measured: ms.length, classified: measurements.length, noVisibleChange: measurements.length - ms.length,
        p50: quantile(ms, .50), p95: quantile(ms, .95), worst: ms.at(-1) ?? null, caseIssue,
        method: 'trusted frame click monotonic epoch → first observed matching host root; polling step 40ms',
      });
    }
    if (!identical((await rootPaint(ctx.page)).values, baseline.values)) await restore(ctx, baseline, id);
  }
  assert.deepEqual(failures, []);
});
