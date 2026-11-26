import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createStudio } from '../core/studio.mjs';
import { createMockHost, createMockWorkspace } from './mock-host.mjs';
import { slotId, slotPath } from './library.mjs';

async function open(t, workspace = createMockWorkspace({ delay: 1 })) {
  const host = createMockHost({ workspace });
  const studio = createStudio({ host, timing: { settle: 0, draftDebounce: 1 } });
  t.after(() => { studio.dispose(); host.dispose(); });
  await studio.start();
  await setImmediate(); // the initial saved-work scan is separate from live-slot discovery
  return { host, studio, workspace };
}
async function saveWork(studio) {
  studio.setLive(false);
  studio.setOverride('colors.primary.base', '#3b6e91');
  assert.equal((await studio.saveAs({ name: 'Two skies', variants: ['light', 'dark'] })).ok, true);
  const [card] = studio.getState().library.saved;
  assert.deepEqual(Object.keys(card.variants).sort(), ['dark', 'light']);
  return card;
}
const bytesAndTimes = (workspace) => structuredClone([...workspace.files]);

test('removing a saved pair affects only the library; survives remount, preserves active-theme identity and can be undone', async (t) => {
  const a = await open(t), card = await saveWork(a.studio);
  a.workspace.refresh();
  a.host.control.select(card.variants.light.id);
  const files = bytesAndTimes(a.workspace);
  assert.equal(a.studio.getState().host.active.light.id, card.variants.light.id);
  assert.equal((await a.studio.removeSaved(card.id)).ok, true);
  assert.equal(a.studio.getState().library.saved.length, 0);
  assert.equal(a.studio.getState().library.removed[0].id, card.id);
  assert.equal(a.studio.getState().host.active.light.id, card.variants.light.id);
  const b = await open(t, a.workspace);
  assert.equal(b.studio.getState().library.saved.length, 0);
  assert.equal(b.studio.getState().library.removed.length, 1);
  assert.equal((await b.studio.undoRemoveSaved(card.id)).ok, true);
  assert.equal(b.studio.getState().library.saved[0].id, card.id);
  assert.deepEqual(bytesAndTimes(a.workspace), files);
});

test('native deletion is reported separately for each witnessed file, and denied or non-work paths never count as deleted', async (t) => {
  const { host, studio } = await open(t), card = await saveWork(studio);
  const { light, dark } = card.variants;
  assert.equal((await studio.checkSavedFiles(card)).remaining.length, 2);
  host.control.deleteFile(light.path); // the user, through native Appearance
  assert.deepEqual(await studio.checkSavedFiles(card), { ok: true, remaining: [dark.path], missing: [light.path] });
  assert.deepEqual(Object.keys(studio.getState().library.saved[0].variants), ['dark']);
  const oldPaths = host.control.writes.length;
  host.control.setGranted(false);
  assert.equal((await studio.checkSavedFiles(card)).code, 'NOT_GRANTED');
  host.control.setGranted(true);
  for (const invalid of [
    { ...card, variants: { light: { ...light, path: '~/Downloads/external.json' } } },
    { id: 'theme-studio-live', variants: { light: { id: slotId('light'), path: slotPath('light') } } },
    { ...card, variants: {} },
  ]) assert.equal((await studio.checkSavedFiles(invalid)).code, 'BAD_PATH');
  host.control.deleteFile(dark.path);
  const final = await studio.checkSavedFiles(card);
  assert.equal(final.ok, true);
  assert.deepEqual(final.remaining, []);
  assert.deepEqual(final.missing.sort(), [dark.path, light.path].sort());
  assert.equal(studio.getState().library.saved.length, 0);
  assert.equal(host.control.writes.length, oldPaths);
});

test('a different work reusing a removed filename is visible, without unhiding the other old variant', async (t) => {
  const { host, studio, workspace } = await open(t), card = await saveWork(studio);
  const path = card.variants.light.path;
  assert.equal((await studio.removeSaved(card.id)).ok, true);
  const replacement = JSON.parse(workspace.files.get(path).content);
  replacement.themeStudio.writer = 'replacement-writer';
  host.control.editFile(path, JSON.stringify(replacement));
  await studio.checkSavedFiles(card);
  assert.deepEqual(Object.keys(studio.getState().library.saved[0].variants), ['light']);
  assert.deepEqual(Object.keys(studio.getState().library.removed[0].variants), ['dark']);
});
