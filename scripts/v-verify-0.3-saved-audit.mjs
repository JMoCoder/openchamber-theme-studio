// Resume the exact two-variant work hidden through the regression suite, and
// distinguish a broken action from an automation locator or disclosure issue.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  act, button, cap, closeSettings, eventually, mount, run, settings, show, snapFiles,
} from './v-verify-0.3-fixture.mjs';

const [instance] = process.argv.slice(2);
await run(instance, 'saved-audit', async ctx => {
  const { page } = ctx;
  const title = 'V03 Keep Pair';
  const pair = ['light', 'dark'].map(v => `theme-studio-v03-keep-pair-${v}.json`);
  const original = snapFiles(ctx);
  assert.ok(pair.every(k => original[k]), 'we start with two files legitimately saved through the UI');
  await mount(ctx);
  await show(ctx, 'theme');
  const disclosure = ctx.frame.locator('.saved-removed');
  const unhide = act(ctx, 'undo-remove-saved').first();
  const probe = () => disclosure.evaluate(el => ({
    expanded: el.open, renderedTitle: el.querySelector('summary')?.innerText,
    commands: [...el.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label'), name: b.textContent, disabled: b.disabled })),
    focus: el.ownerDocument.activeElement?.outerHTML?.slice(0, 170),
  }));
  await disclosure.waitFor();
  const initial = await probe();
  ctx.record('hidden-work-still-on-disk', { original, initial });
  if (!await unhide.isVisible()) {
    const summary = disclosure.locator('summary');
    await summary.click({ position: { x: 30, y: 13 } });
    const immediate = await probe();
    await delay(700);
    const relative = await probe();
    ctx.record('click-on-removed-disclosure', { immediate, after700ms: relative, visible: await unhide.isVisible() });
    if (!await unhide.isVisible()) {
      await summary.press('Enter');
      await delay(160);
      ctx.record('keyboard-on-removed-disclosure', { state: await probe(), visible: await unhide.isVisible() });
    }
  }
  await ctx.shot('removed-disclosure');
  await unhide.click();
  const restored = button(ctx.frame, `Delete or remove ${title}`);
  await restored.waitFor();
  assert.deepEqual(snapFiles(ctx), original);
  ctx.record('list-only-removal-undone', { fileHashesAndMtimesUnchanged: snapFiles(ctx) });
  await restored.click();
  for (const v of ['light', 'dark']) {
    await settings(page, 'appearance');
    await button(page.getByRole('group', { name: 'Themes', exact: true }), cap(v)).click();
    const item = page.getByRole('listbox', { name: `${cap(v)} theme`, exact: true })
      .locator(`[data-theme-id="theme-studio-v03-keep-pair-${v}"]`);
    await button(item, /delete|remove/iu).click();
    const confirm = button(page, /^(Delete|Remove)$/u).filter({ visible: true });
    if (await confirm.waitFor({ timeout: 1000 }).then(() => true, () => false)) await confirm.click();
    await eventually(() => !snapFiles(ctx)[`theme-studio-v03-keep-pair-${v}.json`], `native deletion of ${v}`);
  }
  await closeSettings(page);
  const dialog = ctx.frame.locator('dialog[open]');
  await button(dialog, 'Verify file deletion').click();
  await dialog.getByText('All listed files are gone.', { exact: true }).waitFor();
  assert.deepEqual(snapFiles(ctx), Object.fromEntries(Object.entries(original).filter(([k]) => !pair.includes(k))));
  await ctx.shot('verified-native-deletion');
  ctx.record('native-deletion-verified-after-click', { removed: pair, othersUnchanged: snapFiles(ctx) });
});
