import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, curated, eventually, load, mount, paintSummary, rootPaint, run, sample,
  show, slotFile, snapFiles, stateLine, variant,
} from './v-verify-0.3-fixture.mjs';

const [name] = process.argv.slice(2);
await run(name, 'after-restore', async ctx => {
  const slot = load(slotFile(ctx, 'light'));
  assert.equal(slot.metadata.id, 'theme-studio-live-light', 'start immediately after tested restore');
  await mount(ctx);
  await show(ctx, 'theme');
  if (await variant(ctx, 'light').getAttribute('aria-pressed') !== 'true') await variant(ctx, 'light').click();
  const baseline = await rootPaint(ctx.page);
  assert.equal(baseline.mode, 'light');
  const files = snapFiles(ctx);
  const status = await stateLine(ctx);
  await act(ctx, 'load-preset', 'tidemark').click();
  await eventually(async () => (await sample(ctx)).background === curated('tidemark', 'light').colors.surface.background,
    'new Tidemark selection changes the editor');
  await delay(5600);
  const natural = await rootPaint(ctx.page);
  const equivalent = JSON.stringify(baseline.values) === JSON.stringify(natural.values);
  const screenshot = await ctx.shot('pick-tidemark-after-restore');
  ctx.record('first-fresh-click-after-restore', { rootUnchanged: equivalent,
    diskUnchanged: JSON.stringify(files) === JSON.stringify(snapFiles(ctx)),
    before: paintSummary(baseline), after: paintSummary(natural), beforeStatus: status, afterStatus: await stateLine(ctx),
    files, sample: await sample(ctx), screenshot });
  assert.equal(equivalent, false, 'once Restore succeeds, a new unambiguous built-in preview should work without manually deleting a slot');
});
