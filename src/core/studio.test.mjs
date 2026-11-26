import assert from 'node:assert/strict';
import test from 'node:test';
import '../../panel/builtins.js';
import { parseTheme } from '../../shared/theme-core.mjs';
import { builtinCandidates } from '../data/index.mjs';
import { createMockHost, createMockWorkspace } from '../host/mock-host.mjs';
import { decodeOwned, encodeTheme, inspectImportText, problem, slotId, slotPath, themesDir } from '../host/library.mjs';
import { distinguishPlaceholder, identifyTheme, themeKey, tokensForTheme } from '../host/identify.mjs';
import { THEME_CONFIRMATION_TIMEOUT_MS } from '../host/live.mjs';
import { createPersistence } from '../host/persistence.mjs';
import { createStudio } from './studio.mjs';
import { createHistory } from './history.mjs';
import { newProject, normalizeProject, resolveProject } from './project.mjs';

const definitions = globalThis.__themeStudioBuiltins;
const path = 'colors.primary.base';
const color = (theme) => theme.colors.primary.base;
const variant = 'light';
const runMicrotasks = async () => { for (let i = 0; i < 120; ++i) await Promise.resolve(); };
function clock() {
  const work = new Map();
  let now = 18_000, last = 0;
  const timers = {
    setTimeout(fn, ms = 0) { work.set(++last, { fn, at: now + ms }); return last; },
    clearTimeout(id) { work.delete(id); },
  };
  return {
    now: () => now, timers,
    async advance(delta) {
      const stop = now + delta;
      while (true) {
        await runMicrotasks();
        const next = [...work].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > stop) { now = stop; return; }
        work.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
    },
  };
}
function fixture(t, opts = {}) {
  const time = opts.time ?? clock();
  const { now, timers } = time;
  const workspace = opts.workspace ?? createMockWorkspace({ delay: 520, now, timers, definitions, ...opts });
  const host = createMockHost({ workspace, ...opts });
  const studio = createStudio({ host, now, timers, loadBuiltins: opts.loadBuiltins ?? (async () => definitions),
    timing: { settle: 0, bootTimeout: 140, debounce: 100, timeout: 1000, draftDebounce: 40, ...opts.timing } });
  t.after(() => { studio.dispose(); host.dispose(); });
  return { host, studio, time, workspace };
}
const field = (s, v = variant) => color(s.getState().resolved[v]);
const lane = (s, v = variant) => s.getState().live[v];
const raw = (f, v = variant) => f.workspace.files.get(slotPath(v))?.content;
const later = (time, ms) => new Promise((resolve) => time.timers.setTimeout(resolve, ms));
const hostTimeout = () => problem('HOST_TIMEOUT', 'Host did not answer in time.');
const colorful = (s) => s.loadPreset(s.getState().library.presets[0].slug);
const factory = (v, id = 'openchamber') => definitions[`${id}-${v}`];
const accent = (f) => f.host.control.snapshot().theme.tokens.primary;
const expectTry = async (f) => {
  colorful(f.studio); // Fresh drafts now use the original, not a contrasting preset.
  assert.equal((await f.studio.tryOn(variant)).ok, true);
  await f.time.advance(550);
};

for (const v of ['light', 'dark']) {
  test(`post-restore: ${v} stock theme can preview and restore three times, including after remount`, async (t) => {
    let f = fixture(t, { system: v });
    const start = tokensForTheme(factory(v));
    await f.studio.start();
    let neutral;
    for (const [i, id] of ['blue-etch', 'tidemark', 'kilnmark'].entries()) {
      f.studio.loadPreset(id);
      await f.time.advance(710);
      assert.equal(accent(f), field(f.studio, v), `round ${i + 1} repaints the stock ${v} window`);
      assert.equal(decodeOwned(raw(f, v), v).id, `openchamber-${v}`);
      assert.ok((await f.studio.restoreOriginal()).ok);
      await f.time.advance(710);
      assert.deepEqual(tokensForTheme(f.workspace.theme(`openchamber-${v}`, v)), start);
      const rawNeutral = raw(f, v), def = decodeOwned(rawNeutral, v);
      assert.match(def.writer, /^restored-/u);
      if (i === 0) neutral = rawNeutral;
      else assert.equal(rawNeutral, neutral, 'subsequent restore preserves existing placeholder bytes');
      if (i === 1) {
        f.studio.dispose();
        f = fixture(t, { system: v, time: f.time, workspace: f.workspace });
        await f.studio.start();
        assert.equal(f.host.control.writes.length, 0, 'mount did not repair or rewrite the file');
      }
    }
    const def = decodeOwned(neutral, v);
    const actual = tokensForTheme(def.definition);
    assert.ok(!builtinCandidates.some((row) => row.variant === v && row.key === def.key));
    const changed = Object.keys(start).filter((key) => start[key].toLowerCase() !== actual[key].toLowerCase());
    assert.equal(changed.length, 1, 'only one fingerprint color changes in the placeholder, never the active stock theme');
    const channel = (hex) => hex.slice(1).match(/../gu).map((part) => parseInt(part, 16));
    assert.equal(channel(start[changed[0]]).reduce((a, x, i) => a + Math.abs(x - channel(actual[changed[0]])[i]), 0), 1);
  });

  test(`post-restore: ${v} legacy same-paint placeholder is probed without a migration and its bytes restore even when selected`, async (t) => {
    for (const id of [`openchamber-${v}`, slotId(v)]) {
      const f = fixture(t, { system: v, selected: { [v]: id } });
      const stock = factory(v);
      const original = encodeTheme(stock, newProject({ base: { light: factory('light'), dark: factory('dark') } }),
        { id: slotId(v), name: 'Theme Studio · OpenChamber', writer: 'restored-legacy', rev: 2 });
      f.host.control.editFile(slotPath(v), original);
      await f.time.advance(550);
      await f.studio.start();
      f.studio.setVariant(v === 'light' ? 'dark' : 'light');
      f.host.control.locale('zh');
      assert.ok((await f.studio.recheck(v)).ok);
      assert.equal(f.host.control.writes.length, 0);
      const edition = f.studio.getState().variant;
      f.studio.loadPreset('tidemark');
      await f.time.advance(1870);
      assert.equal(accent(f), field(f.studio, edition));
      assert.equal(decodeOwned(raw(f, v), v).id, id, 'the probe preserves a genuinely selected legacy slot');
      assert.equal(f.host.control.writes.length, id === slotId(v) ? 1 : 2, 'at most one fallback to the stock ID');
      assert.ok((await f.studio.restoreOriginal()).ok);
      await f.time.advance(710);
      assert.equal(raw(f, v), original);
      assert.equal(accent(f), color(stock));
    }
  });
}

test('post-restore: a natively selected fresh placeholder is writable; exact backup and genuine pair survive', async (t) => {
  const f = fixture(t);
  await f.studio.start();
  colorful(f.studio);
  await f.time.advance(720);
  assert.ok((await f.studio.restoreOriginal()).ok);
  await f.time.advance(720);
  const neutral = raw(f);
  f.host.control.select(slotId('light'));
  assert.equal(f.studio.getState().host.active.light.kind, 'slot');
  const imported = inspectImportText(neutral, 'theme-studio-live-light.json');
  assert.equal(imported.ok, true);
  assert.equal(themeKey(imported.definition), themeKey(factory('light')), 'import strips the placeholder-only marker');
  assert.equal(themeKey(resolveProject(imported.project, 'dark')), themeKey(factory('dark')));
  f.studio.setVariant('dark');
  await f.time.advance(710);
  assert.equal(raw(f), neutral, 'a tab alone does not start preview on the selected placeholder');
  f.studio.loadPreset('kilnmark');
  await f.time.advance(710);
  assert.equal(decodeOwned(raw(f), 'light').id, slotId('light'));
  assert.equal(accent(f), field(f.studio, 'dark'));
  const named = await f.studio.saveAs({ name: 'Genuine pair', variants: ['light', 'dark'] });
  const namedBefore = named.paths.map((name) => f.workspace.files.get(name));
  assert.ok((await f.studio.restoreOriginal()).ok);
  await f.time.advance(710);
  assert.equal(raw(f), neutral);
  assert.equal(f.studio.getState().host.active.light.id, slotId('light'));
  assert.deepEqual(named.paths.map((name) => f.workspace.files.get(name)), namedBefore);
});

test('post-restore: a saved twin of a built-in gets one fingerprint probe, not a silent refusal at the first edit', async (t) => {
  const f = fixture(t, { selected: { light: 'flexoki-light' } });
  await f.studio.start();
  const s = f.studio;
  const saved = await s.saveAs({ name: 'Exact Flexoki', variants: ['light'] });
  await f.time.advance(710);
  assert.equal(s.getState().host.active.light.reason, 'ambiguous', 'no claim that the built-in is selected yet');
  const named = f.workspace.files.get(saved.paths[0]);
  f.host.control.select(saved.files[0].id);
  s.setVariant('dark');
  s.loadPreset('tidemark');
  await f.time.advance(160);
  assert.equal(decodeOwned(raw(f), 'light').id, 'flexoki-light');
  const count = f.host.control.writes.length;
  s.setVariant('light'); // queued while the first proof is pending
  s.loadPreset('blue-etch');
  await f.time.advance(1900);
  assert.equal(lane(s).selectionBlocked, true, 'visible reason for stopping after a single inconclusive probe');
  assert.equal(accent(f), color(factory('light', 'flexoki')));
  assert.equal(f.host.control.writes.length, count);
  s.loadPreset('kilnmark');
  s.setVariant('dark');
  f.host.control.locale('en');
  assert.ok((await s.recheck('light')).ok);
  await f.time.advance(2300);
  assert.equal(f.host.control.writes.length, count);
  s.dispose();
  const b = fixture(t, { workspace: f.workspace, time: f.time, selected: { light: saved.files[0].id } });
  await b.studio.start();
  b.studio.loadPreset('kilnmark');
  await b.time.advance(1300);
  assert.equal(b.host.control.writes.length, 0, 'remount cannot issue the same inconclusive probe again');
  assert.equal(lane(b.studio).selectionBlocked, true);
  b.host.control.select('openchamber-light');
  b.studio.loadPreset('tidemark');
  await b.time.advance(710);
  assert.equal(accent(b), field(b.studio, b.studio.getState().variant));
  assert.equal(lane(b.studio).selectionBlocked, false);
  assert.ok((await b.studio.restoreOriginal()).ok);
  assert.deepEqual(f.workspace.files.get(saved.paths[0]), named);
});

test('post-restore: a successful built-in fingerprint probe drains the last queued pick even with saved twins', async (t) => {
  const f = fixture(t);
  const s = f.studio;
  await s.start();
  const saved = await s.saveAs({ name: 'Exact OpenChamber', variants: ['light'] });
  await f.time.advance(700);
  const named = f.workspace.files.get(saved.paths[0]);
  s.loadPreset('tidemark');
  await f.time.advance(155);
  s.setVariant('dark');
  s.loadPreset('blue-etch');
  await f.time.advance(1480);
  assert.equal(accent(f), field(s, 'dark'));
  assert.equal(lane(s).selectionBlocked, false);
  assert.equal(f.host.control.writes.length, 3, 'one saved file, the initial probe and the latest edit');
  assert.ok((await s.restoreOriginal()).ok);
  await f.time.advance(720);
  s.loadPreset('kilnmark');
  await f.time.advance(710);
  assert.equal(accent(f), field(s));
  assert.deepEqual(f.workspace.files.get(saved.paths[0]), named);
});

test('post-restore: placeholder chooses another one-channel step if a saved token signature already has the first one', () => {
  for (const v of ['light', 'dark']) {
    const original = factory(v), fingerprint = themeKey(original);
    const first = distinguishPlaceholder(original, new Set([fingerprint]));
    const second = distinguishPlaceholder(original, new Set([fingerprint, themeKey(first)]));
    assert.notEqual(themeKey(second), themeKey(first));
    assert.notEqual(themeKey(second), fingerprint);
  }
});

test('post-restore matrix: actual selection × disk state, then pick, switch tab, and Restore', async (t) => {
  for (const selection of ['stock', 'builtin', 'slot', 'work', 'unmanaged']) {
    for (const disk of ['missing', 'live', 'legacy', 'neutral', 'crash', 'twin']) {
      await t.test(`${selection}/${disk}`, async (t) => {
        const stock = factory('light'), alternate = factory('light', 'flexoki');
        const stockId = stock.metadata.id, alternateId = alternate.metadata.id, slot = slotId('light');
        const named = 'theme-studio-matrix-light', unmanaged = 'another-app-light';
        const ongoing = disk === 'live' || disk === 'crash';
        const hasSlot = ['legacy', 'neutral'].includes(disk) || (selection === 'slot' && disk !== 'missing');
        const work = (theme) => newProject({ name: 'Matrix', base: { light: theme, dark: factory('dark') } });
        const withAccent = (colorValue) => {
          const theme = parseTheme(stock);
          theme.colors.primary.base = colorValue;
          return theme;
        };
        const hasTwin = disk === 'twin';
        const current = { stock: stockId, builtin: alternateId, slot, work: named, unmanaged }[selection];
        const target = !hasSlot && selection === 'slot' ? stockId : current;
        const startingID = ongoing && !['stock', 'builtin', 'slot'].includes(selection) ? stockId : target;
        let f = fixture(t, { selected: { light: startingID } });
        const edit = (id, theme, writer) => f.host.control.editFile(`${themesDir}/${id}.json`, encodeTheme(theme, work(theme),
          { id, name: 'Theme Studio · Matrix', writer, rev: 1 }));
        if (hasSlot) {
          const initial = disk === 'legacy' ? stock : distinguishPlaceholder(stock, new Set([themeKey(stock)]));
          edit(slot, initial, 'restored-matrix');
        }
        if (selection === 'work' || hasTwin) edit(named, hasTwin ? selection === 'builtin' ? alternate : stock : withAccent('#683797'), 'saved-matrix');
        if (selection === 'unmanaged') {
          const external = withAccent('#573b79');
          f.workspace.addTheme({ ...external, metadata: { ...external.metadata, id: unmanaged } });
        }
        await f.time.advance(700);
        const originalRaw = raw(f);
        const namedPath = `${themesDir}/${named}.json`, originalNamed = f.workspace.files.get(namedPath);
        const original = themeKey(f.workspace.theme(target, 'light'));
        await f.studio.start();
        if (ongoing) {
          f.studio.loadPreset('blue-etch');
          await f.time.advance(700);
          assert.match(decodeOwned(raw(f), 'light').writer, /^preview-/u);
          if (disk === 'crash') {
            f.studio.dispose();
            f = fixture(t, { workspace: f.workspace, time: f.time, selected: { light: target } });
            await f.studio.start();
            assert.equal(f.host.control.writes.length, 0, 'crash recovery reads but does not repair');
          } else f.host.control.select(target);
        } else assert.equal(f.host.control.writes.length, 0);
        const n = f.host.control.writes.length;
        const writable = ['stock', 'builtin', 'slot'].includes(selection);
        f.studio.setVariant('dark');
        await f.time.advance(2000);
        if (writable && ongoing) assert.equal(accent(f), field(f.studio, 'dark'), 'active preview follows tab');
        else assert.equal(f.host.control.writes.length, n, 'tab alone never starts a preview');
        f.studio.loadPreset('tidemark');
        await f.time.advance(2000); // Includes a bounded legacy identity fallback where needed.
        if (writable) {
          assert.equal(accent(f), field(f.studio, 'dark'), `${selection}/${disk} previews`);
          assert.equal(decodeOwned(raw(f), 'light').id, target);
        } else {
          assert.equal(themeKey(f.workspace.theme(target, 'light')), original, 'no edits to a natively selected named/unmanaged theme');
          assert.equal(f.host.control.writes.length, n + (selection === 'work' && hasTwin ? 1 : 0));
          assert.equal(lane(f.studio).selectionBlocked, selection === 'work' && hasTwin);
        }
        f.studio.setVariant('light');
        await f.time.advance(2000);
        if (writable) assert.equal(accent(f), field(f.studio, 'light'), 'next tab follows only the owned, visible preview');
        const restored = await f.studio.restoreOriginal();
        assert.equal(restored.ok, true);
        await f.time.advance(700);
        assert.equal(themeKey(f.workspace.theme(target, 'light')), original, 'exact original native selection colors');
        if (originalRaw) assert.equal(raw(f), originalRaw, 'exact original slot bytes');
        else if (writable || ongoing || hasTwin && selection === 'work') assert.match(decodeOwned(raw(f), 'light').writer, /^restored-/u);
        else assert.equal(raw(f), undefined);
        assert.equal(raw(f, 'dark'), undefined, 'actual host was always Light');
        assert.deepEqual(f.workspace.files.get(namedPath), originalNamed, 'named file contents and mtime are untouched');
      });
    }
  }
});

test('cross-mode preview inherits all colors from the edited edition, not the native variant defaults', async (t) => {
  const f = fixture(t, { selected: { light: 'flexoki-light' } });
  const { studio: s, time, host } = f;
  await s.start();
  s.setVariant('dark');
  await time.advance(700);
  assert.deepEqual(host.control.writes, []);
  await s.loadDefault();
  await time.advance(710);
  const light = decodeOwned(raw(f), 'light');
  const edited = parseTheme(s.getState().resolved.dark);
  assert.equal(light.id, 'flexoki-light');
  assert.equal(light.variant, 'light');
  assert.equal(light.previewVariant, 'dark');
  assert.deepEqual(parseTheme(light.definition).colors, edited.colors);
  assert.equal(accent(f), field(s, 'dark'));
  assert.equal(s.getState().host.active.light.kind, 'tryon', 'the painted edition is not a native light built-in');
  assert.equal(lane(s).previewVariant, 'dark');
  assert.equal(raw(f, 'dark'), undefined);
  s.setVariant('light');
  await time.advance(710);
  assert.equal(accent(f), field(s, 'light'));
  assert.equal(lane(s).previewVariant, 'light');
  s.setVariant('dark');
  await time.advance(710);
  assert.equal(accent(f), field(s, 'dark'));
});

test('a cross-mode tie with an independent built-in stays unidentified after remount, then probes the owned target', async (t) => {
  const f = fixture(t, { selected: { light: 'flexoki-light' } });
  const { studio: s, host, time } = f;
  await s.start();
  s.setVariant('dark');
  const identical = parseTheme(factory('light', 'aura'));
  s.loadProject(newProject({ base: { light: factory('light'),
    dark: { ...identical, metadata: { ...identical.metadata, variant: 'dark' } } } }));
  await time.advance(710);
  assert.equal(lane(s).previewVariant, 'dark');
  assert.equal(decodeOwned(raw(f), 'light').key, themeKey(identical));
  assert.equal(s.getState().host.active.light.id, 'flexoki-light', 'receipt ties a known write to its physical target');
  s.dispose();
  const b = fixture(t, { workspace: f.workspace, time, selected: { light: 'flexoki-light' } });
  await b.studio.start();
  assert.equal(b.studio.getState().host.active.light.reason, 'ambiguous');
  assert.equal(lane(b.studio).previewVariant, null, 'independent identical paint is not proof of selection');
  b.studio.setVariant('light');
  await time.advance(730);
  assert.equal(host.control.writes.length, 1);
  assert.equal(b.host.control.writes.length, 1);
  assert.equal(b.studio.getState().host.active.light.id, 'flexoki-light');
  assert.equal(accent(b), field(b.studio, 'light'));
  assert.ok((await b.studio.restoreOriginal()).ok, 'already-owned bytes are still restorable');
});

test('queued tab switches and quick edits coalesce into the latest painted edition even while awaiting a native receipt', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  s.setOverride(path, '#2f5584');
  s.setVariant('dark'); // Before the first debounce has even sent a write.
  s.setOverride(path, '#af8d6b');
  await time.advance(110);
  assert.equal(JSON.parse(raw(f)).themeStudio.previewVariant, 'dark');
  assert.equal(host.control.writes.length, 1);
  assert.equal(lane(s).sync, 'waiting');
  s.setVariant('light');
  s.setVariant('dark');
  s.setVariant('light');
  s.setOverride(path, '#5b679e');
  await time.advance(1300);
  assert.equal(accent(f), '#5b679e');
  assert.equal(lane(s).previewVariant, 'light');
  assert.equal(host.control.writes.length, 2, 'never paint intermediate tabs');
});

test('receipt timeout drains any explicit queued pick and an identical explicit retry resends only the verified slot', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  host.control.hold();
  s.setOverride(path, '#335f71');
  await time.advance(130);
  assert.equal(lane(s).sync, 'waiting');
  s.setVariant('dark');
  colorful(s);
  await time.advance(2150);
  assert.equal(lane(s).sync, 'timeout');
  assert.equal(host.control.writes.length, 2, 'the queued edition survives the first timeout');
  assert.equal(decodeOwned(raw(f), 'light').previewVariant, 'dark');
  const target = field(s, 'dark');
  colorful(s);
  await time.advance(120);
  assert.equal(host.control.writes.length, 3, 'an explicit same-paint pick still resends after timeout');
  assert.equal(lane(s).sync, 'waiting');
  assert.equal(color(JSON.parse(raw(f))), target);
  host.control.release();
  await time.advance(650);
  assert.equal(lane(s).sync, 'applied');
  assert.equal(accent(f), target);
});

test('cross-mode recovery never turns painted slot colors into work or import colors; a second panel restores both original lanes', async (t) => {
  const a = fixture(t, { selected: { light: 'flexoki-light', dark: 'aura-dark' } });
  const { studio: s, time, workspace } = a;
  await s.start();
  const original = s.getState().project;
  s.setVariant('dark');
  colorful(s);
  await time.advance(700);
  const paintedLight = raw(a);
  const project = s.getState().project;
  const named = await s.saveAs({ name: 'True colors', variants: ['light', 'dark'] });
  const exported = await s.exportFiles({ variants: ['light', 'dark'] });
  const namedBefore = named.paths.map((saved) => ({ ...workspace.files.get(saved) }));
  for (const v of ['light', 'dark']) {
    await s.copyJson(v);
    for (const file of [...named.paths, ...exported.paths].filter((file) => file.endsWith(`-${v}.json`))) {
      const doc = JSON.parse(workspace.files.get(file).content);
      assert.equal(doc.metadata.variant, v);
      assert.equal(doc.themeStudio.previewVariant, undefined);
      assert.equal(color(doc), field(s, v));
    }
    const doc = JSON.parse(a.host.control.clipboard());
    assert.equal(doc.metadata.variant, v);
    assert.equal(color(doc), field(s, v));
  }
  a.host.control.setSystem('dark');
  await time.advance(700);
  assert.equal(raw(a, 'dark'), undefined, 'a native mode change is passive');
  s.setVariant('light'); // Active preview on the other lane may follow this click.
  await time.advance(700);
  assert.equal(decodeOwned(raw(a, 'dark'), 'dark').previewVariant, 'light');
  assert.equal(raw(a), paintedLight);
  s.dispose();

  const b = fixture(t, { time, workspace, system: 'dark', selected: { light: 'flexoki-light', dark: 'aura-dark' } });
  await b.studio.start();
  assert.equal(await b.studio.loadCurrent(), true);
  assert.deepEqual(b.studio.getState().project, project);
  assert.notEqual(field(b.studio, 'dark'), color(JSON.parse(raw(b, 'dark'))));
  const imported = b.studio.importText(paintedLight, 'previous-preview.json');
  assert.ok(imported.ok);
  assert.equal(imported.variant, 'dark', 'the source edition, not the native metadata of the overlay');
  assert.deepEqual(imported.project, project);
  const stale = JSON.parse(paintedLight);
  delete stale.themeStudio.previewVariant;
  assert.equal(b.studio.importText(JSON.stringify(stale), 'damaged-preview.json').ok, false);
  const restored = await b.studio.restoreOriginal();
  assert.ok(restored.ok && restored.variants.light.changed && restored.variants.dark.changed);
  await time.advance(700);
  assert.deepEqual(b.studio.getState().project, original);
  assert.equal(accent(b), color(factory('dark', 'aura')));
  b.host.control.setSystem('light');
  assert.equal(accent(b), color(factory('light', 'flexoki')));
  assert.deepEqual(named.paths.map((saved) => workspace.files.get(saved)), namedBefore);
});

test('the 0.2 file and journal without a painted-edition field carry same-mode preview across upgrades', async (t) => {
  const a = fixture(t), { workspace, time } = a;
  await a.studio.start();
  const original = a.studio.getState().project;
  colorful(a.studio);
  await time.advance(710);
  const legacy = JSON.parse(raw(a));
  delete legacy.themeStudio.previewVariant;
  a.host.control.editFile(slotPath('light'), JSON.stringify(legacy));
  await time.advance(600);
  a.studio.dispose();
  const b = fixture(t, { workspace, time });
  await b.studio.start();
  assert.equal(lane(b.studio).previewVariant, 'light');
  assert.deepEqual(b.host.control.writes, [], 'recovery is passive');
  b.studio.setVariant('dark');
  await time.advance(710);
  assert.equal(lane(b.studio).previewVariant, 'dark');
  assert.ok((await b.studio.restoreOriginal()).ok);
  await time.advance(710);
  assert.deepEqual(b.studio.getState().project, original);
  assert.equal(accent(b), color(factory('light')));
  assert.equal(raw(b, 'dark'), undefined);
});

test('parallel cross-mode editors share the same physical lane lease but live off makes tab and draft changes write nothing', async (t) => {
  const a = fixture(t, { timing: { settle: 30 } }), { workspace, time } = a;
  const b = fixture(t, { workspace, time, timing: { settle: 30 } });
  await Promise.all([a.studio.start(), b.studio.start()]);
  a.studio.setVariant('dark');
  a.studio.setOverride(path, '#faab76');
  b.studio.setOverride(path, '#285f75');
  await time.advance(800);
  assert.equal(a.host.control.writes.length + b.host.control.writes.length, 1);
  assert.equal(raw(a, 'dark'), undefined);
  const owner = a.host.control.writes.length ? a : b;
  assert.equal(decodeOwned(raw(owner), 'light').previewVariant, owner === a ? 'dark' : 'light');
  const before = raw(owner);
  owner.studio.setLive(false);
  owner.studio.setVariant('light');
  owner.studio.setVariant('dark');
  colorful(owner.studio);
  assert.ok((await owner.studio.recheck('light')).ok);
  owner.host.control.locale('zh');
  owner.studio.setLive(true);
  await time.advance(2700);
  assert.equal(a.host.control.writes.length + b.host.control.writes.length, 1);
  assert.equal(raw(owner), before);
});

test('fresh drafts follow the native default or a known current theme; opening, locale, tab and read actions are passive', async (t) => {
  const a = fixture(t);
  await a.studio.start();
  assert.equal(a.studio.getState().project.origin.kind, 'default');
  for (const v of ['light', 'dark']) assert.deepEqual(
    parseTheme(a.studio.getState().resolved[v]).colors, parseTheme(factory(v)).colors);
  const states = [];
  const unsubscribe = a.studio.subscribe(({ locale }) => states.push(locale));
  a.host.control.locale('zh-Hans');
  assert.equal(states.at(-1), 'zh');
  a.studio.setVariant('dark');
  assert.equal((await a.studio.recheck('light')).ok, true);
  a.studio.setLive(false);
  a.studio.setLive(true);
  await a.time.advance(650);
  assert.deepEqual(a.host.control.writes, []);
  unsubscribe();

  const b = fixture(t, { selected: { light: 'flexoki-light' } });
  await b.studio.start();
  assert.deepEqual(b.studio.getState().project.origin, { kind: 'builtin', ref: 'flexoki' });
  assert.equal(field(b.studio), accent(b));
  assert.deepEqual(b.host.control.writes, []);
});

test('reselecting even the same preset or built-in clears only the old style; Default is unlayered and undoable', async (t) => {
  const { studio: s } = fixture(t);
  await s.start();
  s.setLive(false);
  colorful(s);
  s.setTune({ global: { hue: 15 } });
  s.setOverride(path, '#562488');
  s.setStyle({ id: 'brutalism', strength: 0.45 });
  colorful(s);
  let project = s.getState().project;
  assert.equal(project.style.light.id, null);
  assert.equal(project.style.dark.id, null);
  assert.equal(project.tune.light.global.hue, 15);
  assert.equal(project.overrides.light[path], '#562488');

  await s.loadBuiltin('flexoki');
  const base = s.getState().resolved.light;
  s.setStyle({ id: 'brutalism', strength: 0.6 });
  assert.notDeepEqual(s.getState().resolved.light, base);
  s.setStyle({ id: null });
  assert.deepEqual(s.getState().resolved.light, base);
  s.setStyle({ id: 'brutalism', strength: 0.25 });
  await s.loadBuiltin('flexoki');
  project = s.getState().project;
  assert.equal(project.style.light.id, null);
  assert.equal(project.tune.light.global.hue, 15);
  assert.equal(project.overrides.light[path], '#562488');

  s.setStyle({ id: 'brutalism', strength: 0.75 });
  const before = s.getState().project;
  assert.equal((await s.loadDefault()).ok, true);
  for (const v of ['light', 'dark']) {
    assert.deepEqual(parseTheme(s.getState().resolved[v]).colors, parseTheme(factory(v)).colors);
    assert.equal(s.getState().project.style[v].id, null);
    assert.equal(s.getState().project.tune[v].global.hue, 0);
    assert.deepEqual(s.getState().project.overrides[v], {});
  }
  s.undo();
  assert.deepEqual(s.getState().project, before);
  s.redo();
  assert.equal(s.getState().project.origin.kind, 'default');
});

test('active clicks preview in both visible modes; Default paints stock colors but Restore returns both personal window colors and editing start', async (t) => {
  const f = fixture(t, { selected: { light: 'flexoki-light', dark: 'aura-dark' } });
  const { studio: s, host, time } = f;
  await s.start();
  const original = s.getState().project;
  const initialLight = accent(f);
  colorful(s);
  await time.advance(650);
  assert.equal(accent(f), field(s));
  assert.notEqual(accent(f), initialLight);
  assert.equal(decodeOwned(raw(f), 'light').id, 'flexoki-light');
  assert.equal(decodeOwned(raw(f), 'light').borrowedApplied, false);

  assert.equal((await s.loadDefault()).ok, true);
  await time.advance(650);
  assert.equal(accent(f), color(factory('light')));
  assert.equal(decodeOwned(raw(f), 'light').id, 'flexoki-light');
  s.undo();
  await time.advance(650);
  assert.equal(accent(f), field(s));

  host.control.setSystem('dark');
  const initialDark = accent(f);
  await time.advance(650);
  assert.equal(raw(f, 'dark'), undefined);
  assert.equal(accent(f), initialDark);
  colorful(s); // An active click can paint Light into this newly active Dark lane.
  await time.advance(650);
  assert.equal(decodeOwned(raw(f, 'dark'), 'dark').previewVariant, 'light');
  assert.equal(accent(f), field(s, 'light'));
  s.setVariant('dark');
  await time.advance(650);
  assert.equal(decodeOwned(raw(f, 'dark'), 'dark').previewVariant, 'dark');
  assert.equal(accent(f), field(s, 'dark'));
  s.setOverride(path, '#765178');
  await time.advance(650);
  assert.equal(accent(f), '#765178');
  assert.equal(decodeOwned(raw(f, 'dark'), 'dark').id, 'aura-dark');
  const restored = await s.restoreOriginal();
  assert.ok(restored.ok && restored.variants.light.changed && restored.variants.dark.changed);
  assert.equal(s.getState().variant, 'light');
  assert.deepEqual(s.getState().project, original);
  await time.advance(650);
  assert.equal(accent(f), initialDark);
  host.control.setSystem('light');
  assert.equal(accent(f), initialLight);
  for (const v of ['light', 'dark']) assert.equal(decodeOwned(raw(f, v), v).id, slotId(v));
  const count = host.control.writes.length;
  assert.ok((await s.restoreOriginal()).ok);
  assert.equal(host.control.writes.length, count, 'restore is idempotent');
});

test('a preselected long-term slot is recovered byte-for-byte across a remount, without applying the stored draft on open', async (t) => {
  const baseProject = newProject({ base: { light: factory('light', 'flexoki'), dark: factory('dark', 'flexoki') },
    kind: 'builtin', ref: 'flexoki', name: 'My prior slot' });
  const project = { ...baseProject, overrides: { light: { [path]: '#685a41' }, dark: {} } };
  const native = encodeTheme(resolveProject(project, 'light'), project, { id: slotId('light'), name: 'My prior slot', writer: 'prior-panel', rev: 7 });
  const oldBytes = `${JSON.stringify(JSON.parse(native), null, 2)}\n\n`;
  const opts = { selected: { light: slotId('light') } };
  const a = fixture(t, opts);
  a.host.control.editFile(slotPath('light'), oldBytes);
  await a.time.advance(550);
  await a.studio.start();
  assert.equal(lane(a.studio).active.kind, 'slot');
  const opening = a.studio.getState().project;
  const priorColor = accent(a);
  a.studio.setOverride(path, '#965341');
  await a.time.advance(650);
  assert.equal(accent(a), '#965341');
  assert.equal(decodeOwned(raw(a), 'light').id, slotId('light'));
  a.studio.setLive(false);
  a.studio.setOverride(path, '#126741');
  await a.studio.flushDraft();
  a.studio.dispose();

  const b = fixture(t, { ...opts, time: a.time, workspace: a.workspace });
  await b.studio.start();
  assert.equal(field(b.studio), '#126741');
  assert.equal(accent(b), '#965341');
  await b.time.advance(800);
  assert.deepEqual(b.host.control.writes, []);
  const result = await b.studio.restoreOriginal();
  assert.ok(result.ok && result.observable);
  assert.equal(raw(b), oldBytes);
  assert.deepEqual(b.studio.getState().project, opening);
  await b.time.advance(650);
  assert.equal(accent(b), priorColor);
});

test('restoration cancels queued/preflight paints, serializes an actual in-flight write and does not overwrite later editor changes', async (t) => {
  const a = fixture(t);
  await a.studio.start();
  const stat = a.host.stat;
  a.host.stat = async (name) => {
    if (name === themesDir) await later(a.time, 550);
    return stat(name);
  };
  a.studio.setOverride(path, '#624768');
  await a.time.advance(120);
  assert.equal(lane(a.studio).sync, 'preflight');
  const cancelled = a.studio.restoreOriginal();
  await a.time.advance(650);
  assert.ok((await cancelled).ok);
  assert.deepEqual(a.host.control.writes, []);
  assert.equal(field(a.studio), color(factory('light')));

  const b = fixture(t, { writeDelay: 300 });
  await b.studio.start();
  b.studio.setOverride(path, '#375b74');
  await b.time.advance(130);
  assert.equal(lane(b.studio).sync, 'writing');
  const restoring = b.studio.restoreOriginal();
  assert.equal(b.studio.getState().live.restoring, true);
  b.studio.setOverride(path, '#7a6080');
  await b.time.advance(1600);
  assert.ok((await restoring).ok);
  assert.equal(b.studio.getState().live.restoring, false);
  assert.equal(field(b.studio), '#7a6080');
  assert.equal(accent(b), color(factory('light')));
  assert.equal(b.host.control.writes.length, 2, 'the authorized preview already sent; Restore is the final write');
  assert.equal(decodeOwned(raw(b), 'light').id, slotId('light'));
});

test('rapid picks and slow built-in loading do not paint stale projects or drop a style picked afterwards', async (t) => {
  let resolveDefinitions;
  const loadBuiltins = () => new Promise((resolve) => { resolveDefinitions = resolve; });
  const f = fixture(t, { loadBuiltins });
  await f.studio.start();
  colorful(f.studio);
  let slow = f.studio.loadBuiltin('flexoki');
  await f.time.advance(200);
  assert.deepEqual(f.host.control.writes, []);
  await f.studio.loadDefault();
  resolveDefinitions(definitions);
  assert.equal(await slow, false);
  await f.time.advance(150);
  assert.deepEqual(f.host.control.writes, [], 'the final default already matches the window');

  f.studio.setStyle({ id: 'brutalism', strength: 0.3 });
  slow = f.studio.loadBuiltin('flexoki');
  f.studio.setStyle({ id: 'brutalism', strength: 0.7 });
  resolveDefinitions(definitions);
  assert.equal(await slow, true);
  assert.equal(f.studio.getState().project.style.light.strength, 0.7);
  await f.time.advance(700);
  assert.equal(f.host.control.writes.length, 1);
  assert.equal(accent(f), field(f.studio));
});

test('unverified or unknown surfaces stay panel-only; retry is read-only and a new explicit click can preview', async (t) => {
  const f = fixture(t);
  const stat = f.host.stat;
  let unavailable = true;
  f.host.stat = (name) => {
    if (unavailable && name === themesDir) return Promise.reject(hostTimeout());
    return stat(name);
  };
  await f.studio.start();
  colorful(f.studio);
  await f.time.advance(700);
  assert.deepEqual(f.host.control.writes, []);
  unavailable = false;
  assert.ok((await f.studio.retry()).ok);
  const original = f.host.control.snapshot();
  f.host.control.push({ ...original, theme: { ...original.theme, tokens: { ...original.theme.tokens, primary: '#20446a' } } });
  f.studio.setOverride(path, '#7b4877');
  await f.time.advance(700);
  assert.deepEqual(f.host.control.writes, []);
  f.host.control.push(original);
  await f.time.advance(700);
  assert.deepEqual(f.host.control.writes, [], 'ready is not a preview action');
  colorful(f.studio);
  await f.time.advance(700);
  assert.equal(accent(f), '#7b4877');
  assert.equal(f.host.control.writes.length, 1);
  const restored = await f.studio.restoreOriginal();
  assert.equal(restored.ok, true, 'one recheck after a shared directory failure must suffice for the two-mode Restore');
  assert.equal(restored.variants.dark.changed, false);
  assert.equal(raw(f, 'dark'), undefined, 'the untouched variant was only rechecked, never written');
});

test('a preview retry only verifies a timed-out write; a foreign replacement or missing backup is never overwritten by Restore', async (t) => {
  const f = fixture(t);
  await f.studio.start();
  const read = f.host.readFile;
  let unreadable = true;
  f.host.readFile = (name) => {
    if (unreadable && name === slotPath('light')) return Promise.reject(hostTimeout());
    return read(name);
  };
  f.host.control.failWrite(hostTimeout(), { after: true });
  f.studio.setOverride(path, '#447a73');
  await f.time.advance(700);
  assert.equal(lane(f.studio).connection, 'verify-error');
  unreadable = false;
  assert.ok((await f.studio.retry()).ok);
  assert.equal(f.host.control.writes.length, 1);
  assert.equal(accent(f), '#447a73');

  f.host.control.editFile(slotPath('light'), '{"foreign":true}');
  const conflict = await f.studio.restoreOriginal();
  assert.equal(conflict.code, 'CONFLICT');
  assert.equal(raw(f), '{"foreign":true}');
  assert.equal(f.host.control.writes.length, 1);

  const a = fixture(t);
  await a.studio.start();
  colorful(a.studio);
  await a.time.advance(700);
  const oldPreview = JSON.parse(raw(a));
  delete oldPreview.themeStudio.origin;
  a.host.control.editFile(slotPath('light'), JSON.stringify(oldPreview));
  await a.time.advance(550);
  a.studio.dispose();
  a.workspace.uninstall();
  const b = fixture(t, { workspace: a.workspace, time: a.time });
  await b.studio.start();
  const prior = raw(b);
  const missing = await b.studio.restoreOriginal();
  assert.equal(missing.code, 'PREVIEW_BACKUP_MISSING');
  assert.equal(raw(b), prior);
  assert.deepEqual(b.host.control.writes, []);
});

test('reinstall rehydrates both journals without repainting, then one Restore rewrites the exact original or reveals native colors', async (t) => {
  const a = fixture(t);
  const project = newProject({ base: { light: factory('light', 'flexoki'), dark: factory('dark', 'flexoki') } });
  const original = `\t${JSON.stringify(JSON.parse(encodeTheme(factory('light', 'flexoki'), project,
    { id: slotId('light'), name: 'Original · 自用', writer: 'normal-writer', rev: 17 })), null, 2)}\r\n`;
  a.host.control.editFile(slotPath('light'), original);
  await a.time.advance(550);
  await a.studio.start();
  const saved = await a.studio.saveAs({ name: 'Unchanged', variants: 'both' });
  const savedFiles = saved.paths.map((path) => [path, a.workspace.files.get(path)]);
  a.studio.loadPreset('tidemark');
  await a.time.advance(700);
  a.host.control.setSystem('dark');
  a.studio.setVariant('dark');
  a.studio.loadPreset('hojicha');
  await a.time.advance(700);
  const painted = ['light', 'dark'].map((v) => raw(a, v));
  for (const [index, v] of ['light', 'dark'].entries()) {
    const { themeStudio } = JSON.parse(painted[index]);
    assert.deepEqual(themeStudio.origin, { writer: themeStudio.writer, raw: v === 'light' ? original : null });
  }
  await a.studio.flushDraft();
  a.studio.dispose();
  a.workspace.uninstall();
  assert.deepEqual([...a.workspace.values], []);

  const b = fixture(t, { workspace: a.workspace, time: a.time });
  await b.studio.start();
  b.host.control.locale('zh');
  b.studio.setLive(false);
  b.studio.setLive(true);
  assert.ok((await b.studio.recheck('light')).ok);
  assert.deepEqual(b.host.control.writes, []);
  assert.deepEqual(['light', 'dark'].map((v) => raw(b, v)), painted);
  const journal = createPersistence(b.host.storage);
  for (const [index, v] of ['light', 'dark'].entries()) {
    assert.equal(lane(b.studio, v).recovery, null);
    assert.deepEqual(await journal.get(`preview-original-${v}`),
      { id: JSON.parse(painted[index]).themeStudio.writer, raw: v === 'light' ? original : null });
  }
  assert.ok((await b.studio.restoreOriginal()).ok);
  await b.time.advance(700);
  assert.equal(raw(b, 'light'), original);
  assert.equal(decodeOwned(raw(b, 'dark'), 'dark').id, slotId('dark'));
  assert.equal(field(b.studio), color(factory('light')), 'editor recovers the known factory palette, not the lost draft');
  for (const v of ['light', 'dark']) {
    assert.deepEqual(tokensForTheme(b.workspace.theme(`openchamber-${v}`, v)), tokensForTheme(factory(v)));
  }
  assert.deepEqual(savedFiles.map(([path]) => [path, b.workspace.files.get(path)]), savedFiles);
});

test('reinstall can keep previewing without first restoring, keeping the same journal even if the cache cannot be rebuilt', async (t) => {
  const a = fixture(t, { system: 'dark' });
  await a.studio.start();
  a.studio.loadPreset('tidemark');
  await a.time.advance(700);
  const painted = raw(a, 'dark');
  const first = JSON.parse(painted).themeStudio;
  await a.studio.flushDraft();
  a.studio.dispose();
  a.workspace.uninstall();
  const b = fixture(t, { workspace: a.workspace, time: a.time, system: 'dark' });
  const set = b.host.storage.set;
  b.host.storage.set = (key, val) => key === 'studio:v1:preview-original-dark'
    ? Promise.reject(problem('STORAGE_QUOTA', 'Cache unavailable')) : set(key, val);
  await b.studio.start();
  assert.equal(lane(b.studio, 'dark').canPreview, true);
  assert.deepEqual(b.host.control.writes, []);
  b.studio.loadPreset('hojicha');
  await b.time.advance(700);
  const continued = raw(b, 'dark');
  assert.notEqual(continued, painted);
  assert.equal(accent(b), field(b.studio, 'dark'));
  assert.equal(JSON.parse(continued).themeStudio.writer, first.writer);
  assert.deepEqual(JSON.parse(continued).themeStudio.origin, first.origin);
  assert.ok((await b.studio.restoreOriginal()).ok);
  await b.time.advance(700);
  assert.equal(accent(b), color(factory('dark')));
});

for (const version of ['0.1', '0.3.0']) test(`a lost ${version} trial can reveal a known built-in without changing the editor or a named theme`, async (t) => {
  const f = fixture(t, { system: 'dark', selected: { dark: 'flexoki-dark' } });
  const dark = structuredClone(factory('dark'));
  dark.colors.primary.base = '#a23e76';
  const project = newProject({ base: { light: factory('light'), dark } });
  const preJournal = version === '0.1';
  const oldWriter = preJournal ? 'ordinary-legacy-writer' : 'preview-legacy';
  const legacy = encodeTheme(dark, project,
    { id: 'flexoki-dark', name: 'Theme Studio · Legacy（试穿）', writer: oldWriter, rev: 1,
      previewVariant: preJournal ? undefined : 'dark' });
  f.host.control.editFile(slotPath('dark'), legacy);
  await f.time.advance(550);
  await f.studio.start();
  const saved = await f.studio.saveAs({ name: 'Legacy Refuge', variants: 'both' });
  const named = saved.paths.map((path) => f.workspace.files.get(path));
  assert.equal(lane(f.studio, 'dark').recovery, 'builtin');
  f.studio.loadPreset('hojicha');
  await f.time.advance(700);
  assert.equal(raw(f, 'dark'), legacy, 'picking a card before recovering does not overwrite a legacy orphan');
  const editor = f.studio.getState().project;
  const report = await f.studio.recoverBuiltin('dark', 'flexoki-dark');
  assert.ok(report.ok && report.observable, JSON.stringify(report));
  await f.time.advance(700);
  const restored = decodeOwned(raw(f, 'dark'), 'dark');
  assert.equal(restored.id, slotId('dark'));
  assert.notEqual(restored.writer, oldWriter);
  if (!preJournal) assert.equal(restored.writer, 'restored-legacy');
  assert.ok(!builtinCandidates.some((item) => item.variant === 'dark' && item.key === restored.key));
  assert.deepEqual(tokensForTheme(f.workspace.theme('flexoki-dark', 'dark')), tokensForTheme(factory('dark', 'flexoki')));
  assert.equal(f.studio.getState().project, editor, 'legacy recovery is not an editor reset');
  assert.deepEqual(saved.paths.map((path) => f.workspace.files.get(path)), named);
  assert.equal(raw(f, 'light'), undefined);
});

test('a legacy self-ID or unverifiable embedded original never authorizes a destructive reset', async (t) => {
  const project = newProject({ base: { light: factory('light'), dark: factory('dark') } });
  const encoded = (id, writer, v = 'light') => encodeTheme(factory(v), project, { id, name: id, writer, rev: 1 });
  const own = encoded(slotId('light'), 'old');
  const cases = [
    ['legacy self-ID', true, undefined],
    ['wrong writer', false, { writer: 'preview-other', raw: null }],
    ['missing raw', false, { writer: 'preview-legacy' }],
    ['nested preview', false, { writer: 'preview-legacy', raw: encoded(slotId('light'), 'preview-inner') }],
    ['named theme', false, { writer: 'preview-legacy', raw: encoded('theme-studio-named-light', 'old') }],
    ['other variant', false, { writer: 'preview-legacy', raw: encoded(slotId('dark'), 'old', 'dark') }],
    ['oversize origin', false, { writer: 'preview-legacy', raw: own.padEnd(512 * 1024 + 1, ' ') }],
  ];
  for (const [label, self, origin] of cases) await t.test(label, async (t) => {
    const id = self ? slotId('light') : 'openchamber-light';
    const f = fixture(t, { selected: { light: id } });
    const data = JSON.parse(encoded(id, 'preview-legacy'));
    data.themeStudio.origin = origin;
    const rawOrphan = JSON.stringify(data);
    f.host.control.editFile(slotPath('light'), rawOrphan);
    await f.time.advance(550);
    await f.studio.start();
    assert.equal(lane(f.studio).recovery, 'preserve');
    assert.equal(lane(f.studio).canPreview, false);
    assert.equal((await f.studio.restoreOriginal()).code, 'PREVIEW_BACKUP_MISSING');
    assert.equal((await f.studio.recoverBuiltin('light', id)).ok, false);
    assert.equal((await f.studio.apply('light')).ok, false);
    assert.equal(raw(f), rawOrphan);
    assert.deepEqual(f.host.control.writes, []);
    assert.equal(await createPersistence(f.host.storage).get('preview-original-light'), undefined);
  });
});

test('Restore reports uncertain reads instead of guessing window or editor state, then a read-only recheck recovers the origin', async (t) => {
  const a = fixture(t);
  await a.studio.start();
  const opening = a.studio.getState().project;
  colorful(a.studio);
  await a.time.advance(700);
  const painted = raw(a);
  a.studio.dispose();

  const b = fixture(t, { time: a.time, workspace: a.workspace });
  const get = b.host.storage.get;
  let unavailable = true;
  b.host.storage.get = (key) => unavailable && /^studio:v1:(editor-origin|preview-original-light)$/u.test(key)
    ? Promise.reject(hostTimeout()) : get(key);
  await b.studio.start();
  const edited = b.studio.getState().project;
  let result = await b.studio.restoreOriginal();
  assert.equal(result.code, 'HOST_TIMEOUT');
  assert.equal(result.variants.light.ok, false);
  assert.equal(result.editorChanged, false);
  assert.deepEqual(b.studio.getState().project, edited);
  assert.equal(raw(b), painted);
  assert.deepEqual(b.host.control.writes, []);
  unavailable = false;
  assert.ok((await b.studio.retry()).ok);
  assert.equal(raw(b), painted, 'retry does not repaint');
  result = await b.studio.restoreOriginal();
  assert.ok(result.ok && result.editorChanged);
  assert.deepEqual(b.studio.getState().project, opening);
  await b.time.advance(650);
  assert.equal(accent(b), color(factory('light')));
});

test('a neutralized slot can be reopened safely even if deleting the previous restoration journal timed out', async (t) => {
  const a = fixture(t);
  await a.studio.start();
  colorful(a.studio);
  await a.time.advance(700);
  const set = a.host.storage.set;
  a.host.storage.set = (key, value) => key === 'studio:v1:preview-original-light' && value.value === null
    ? Promise.reject(hostTimeout()) : set(key, value);
  assert.ok((await a.studio.restoreOriginal()).ok);
  const neutral = raw(a);
  assert.match(decodeOwned(neutral, 'light').writer, /^restored-/u);
  a.studio.dispose();
  const b = fixture(t, { time: a.time, workspace: a.workspace });
  await b.studio.start();
  assert.ok((await b.studio.restoreOriginal()).ok);
  assert.deepEqual(b.host.control.writes, []);
  assert.equal(raw(b), neutral);
});

test('saving captures the clicked draft without touching a slot, while a newer manual edit alone paints', async (t) => {
  const f = fixture(t);
  await f.studio.start();
  f.studio.setLive(false);
  f.studio.setOverride(path, '#386b68');
  const write = f.host.writeFile;
  f.host.writeFile = async (name, content) => {
    if (name !== slotPath('light')) await later(f.time, 300);
    return write(name, content);
  };
  const saving = f.studio.saveAs({ name: 'Frozen snapshot', variants: ['light'] });
  await f.time.advance(50);
  f.studio.setLive(true);
  assert.deepEqual(f.host.control.writes, []);
  f.studio.setOverride(path, '#887969');
  await f.time.advance(950);
  const result = await saving;
  assert.ok(result.ok);
  assert.equal(color(JSON.parse(f.workspace.files.get(result.paths[0]).content)), '#386b68');
  assert.equal(accent(f), '#887969');
  assert.equal(f.host.control.writes.filter((item) => item.path === slotPath('light')).length, 1);
});

test('all 62 built-ins carry unique full 24-token fingerprints; absence and ambiguity fail closed', () => {
  assert.equal(builtinCandidates.length, 62);
  const keys = new Set();
  for (const choice of builtinCandidates) {
    const tokens = tokensForTheme(definitions[choice.id]);
    assert.equal(Object.keys(tokens).length, 24);
    assert.equal(choice.key, themeKey(definitions[choice.id]));
    assert.equal(identifyTheme({ mode: choice.variant, tokens }, builtinCandidates).id, choice.id);
    assert.equal(identifyTheme({ mode: choice.variant, tokens }, [...builtinCandidates, { ...choice, id: 'another' }]).reason, 'ambiguous');
    assert.equal(identifyTheme({ mode: choice.variant, tokens: { ...tokens, primary: undefined } }, builtinCandidates).kind, 'unknown');
    keys.add(`${choice.variant}:${choice.key}`);
  }
  assert.equal(keys.size, 62);
});

for (const mode of ['borrow', 'slot']) {
  test(`${mode}: saving an exact copy preserves live edits and reconnects after a panel remount`, async (t) => {
    const a = fixture(t), { studio: s, host, workspace, time } = a;
    await s.start();
    colorful(s);
    if (mode === 'borrow') assert.equal((await s.apply()).mode, 'borrow');
    else assert.equal((await s.prepareSlot(variant)).ok, true);
    await time.advance(550);
    const selected = mode === 'borrow' ? 'openchamber-light' : slotId(variant);
    const connection = mode === 'borrow' ? 'tryon' : 'active';
    host.control.select(selected);
    const saved = await s.saveAs({ name: 'Identical colors', variants: [variant] });
    assert.ok(saved.ok);
    assert.equal(lane(s).connection, connection);
    if (mode === 'borrow') assert.equal(lane(s).borrowed.inUse, true);
    await time.advance(550);
    const savedBytes = workspace.files.get(saved.paths[0]).content;
    assert.equal(color(JSON.parse(savedBytes)), field(s));
    s.dispose();
    const b = fixture(t, { workspace, time, selected: { light: selected } });
    await b.studio.start();
    await runMicrotasks();
    assert.equal(b.studio.getState().library.saved.length, 1);
    assert.equal(lane(b.studio).connection, connection);
    if (mode === 'borrow') assert.equal(lane(b.studio).borrowed.inUse, true);

    b.studio.setOverride(path, '#864329');
    await time.advance(160);
    assert.equal(color(JSON.parse(raw(b))), '#864329');
    assert.equal(lane(b.studio).sync, 'waiting');
    b.studio.setOverride(path, '#86432a');
    await time.advance(250);
    assert.equal(color(JSON.parse(raw(b))), '#864329', 'queue only until the initial write is confirmed');
    await time.advance(1150);
    assert.equal(color(JSON.parse(raw(b))), '#86432a');
    assert.equal(b.host.control.snapshot().theme.tokens.primary, '#86432a');
    assert.equal(lane(b.studio).connection, connection);
    assert.equal(lane(b.studio).sync, 'applied');
    assert.equal(workspace.files.get(saved.paths[0]).content, savedBytes);
  });

  test(`${mode}: if the native picker selected the same-colored saved work, one missed probe stops further automatic writes`, async (t) => {
    const f = fixture(t), { studio: s, host, time, workspace } = f;
    await s.start();
    colorful(s);
    if (mode === 'borrow') await s.apply();
    else await s.prepareSlot(variant);
    await time.advance(550);
    if (mode === 'slot') host.control.select(slotId(variant));
    const report = await s.saveAs({ name: 'Selected saved work', variants: [variant] });
    assert.ok(report.ok);
    await time.advance(550);
    const [saved] = report.files;
    host.control.select(saved.id);
    const originalColor = host.control.snapshot().theme.tokens.primary;
    const count = host.control.writes.length;
    s.setOverride(path, '#725378');
    await time.advance(160);
    assert.equal(host.control.writes.length, count + 1);
    assert.equal(color(JSON.parse(raw(f))), '#725378');
    assert.equal(lane(s).sync, 'waiting');
    s.setOverride(path, '#626673');
    await time.advance(1040);
    assert.equal(host.control.snapshot().theme.tokens.primary, originalColor);
    assert.equal(lane(s).sync, 'timeout');
    assert.equal(s.getState().host.active.light.id, saved.id);
    if (mode === 'borrow') assert.equal(lane(s).borrowed.inUse, false);
    else assert.equal(lane(s).connection, 'idle');

    s.setOverride(path, '#235779');
    await time.advance(1200);
    assert.equal(host.control.writes.length, count + 1);
    assert.equal(color(JSON.parse(workspace.files.get(saved.path).content)), originalColor);
  });
}

test('two saved names, export, import, load from my works and undo do not detach a matching borrowed slot', async (t) => {
  const { studio: s, host, workspace, time } = fixture(t);
  await s.start();
  colorful(s);
  await s.apply();
  await time.advance(550);
  const original = field(s);
  const first = await s.saveAs({ name: 'First copy', variants: [variant] });
  const second = await s.saveAs({ name: 'Second copy', variants: [variant] });
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.paths[0], second.paths[0]);
  assert.equal(lane(s).borrowed.inUse, true);
  await time.advance(550);

  const exported = await s.exportFiles({ variants: [variant] });
  assert.ok(exported.ok);
  const text = workspace.files.get(exported.paths[0]).content;
  assert.ok(s.importText(text, 'export.json').ok);
  assert.equal(field(s), original);
  assert.equal(lane(s).borrowed.inUse, true);
  assert.equal(await s.loadSaved(second.files[0].id), true);
  await time.advance(650);
  assert.equal(lane(s).borrowed.inUse, true);
  s.undo();
  await time.advance(650);
  assert.equal(field(s), original);
  assert.equal(lane(s).borrowed.inUse, true);
  s.setOverride(path, '#8c4760');
  await time.advance(650);
  assert.equal(host.control.snapshot().theme.tokens.primary, '#8c4760');
  assert.equal(lane(s).sync, 'applied');
  s.undo();
  await time.advance(650);
  assert.equal(host.control.snapshot().theme.tokens.primary, original);
  assert.equal(lane(s).borrowed.inUse, true);
  assert.equal(lane(s).sync, 'applied');
});

test('a saved identical built-in never licenses borrowing; applying unchanged built-in colors cannot prove a visible update', async (t) => {
  const a = fixture(t), { studio: s, host, time } = a;
  await s.start();
  await s.loadBuiltin('openchamber');
  assert.equal((await s.saveAs({ name: 'Unchanged built-in', variants: [variant] })).ok, true);
  await time.advance(550);
  assert.equal(s.getState().host.active.light.kind, 'unknown');
  assert.equal(lane(s).canTryOn, false);
  const prepared = await s.apply();
  assert.equal(prepared.mode, 'slot');
  assert.equal(prepared.observable, false);
  assert.equal(JSON.parse(raw(a)).metadata.id, slotId(variant));
  assert.equal(host.control.snapshot().theme.tokens.primary, color(definitions['openchamber-light']));

  const b = fixture(t);
  await b.studio.start();
  await b.studio.loadBuiltin('openchamber');
  const unchanged = await b.studio.apply();
  assert.equal(unchanged.mode, 'borrow');
  assert.equal(unchanged.observable, false);
  await b.time.advance(550);
  assert.equal(lane(b.studio).borrowed.inUse, null);
  assert.equal(lane(b.studio).sync, 'idle');
});

test('dual identity changes only owned filename and reverts host with an observed snapshot', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  assert.equal(s.getState().host.active.light.id, 'openchamber-light');
  const original = host.control.snapshot().theme.tokens.primary;
  colorful(s);
  const going = await s.tryOn(variant);
  assert.equal(going.ok, true);
  assert.equal(lane(s).sync, 'waiting');
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
  await time.advance(550);
  assert.equal(lane(s).connection, 'tryon');
  assert.equal(lane(s).sync, 'applied');
  assert.equal(host.control.snapshot().theme.tokens.primary, field(s));
  const ending = await s.endTryOn(variant);
  assert.equal(ending.ok, true);
  assert.equal(JSON.parse(raw(f)).metadata.id, slotId(variant));
  await time.advance(550);
  assert.equal(host.control.snapshot().theme.tokens.primary, original);
  assert.equal(lane(s).sync, 'applied');
});

test('first Apply borrows the uniquely identified built-in and persists confirmation without an orphaned-preview banner', async (t) => {
  const a = fixture(t), { studio: s, host, workspace, time } = a;
  await s.start();
  const original = host.control.snapshot().theme.tokens.primary;
  assert.equal(lane(s).canTryOn, true);
  s.setOverride(path, '#84284f');
  const result = await s.apply();
  assert.equal(result.mode, 'borrow');
  assert.equal(result.ok, true);
  assert.equal(lane(s).borrowed.applied, true);
  assert.equal(lane(s).borrowed.inUse, null);
  assert.equal(lane(s).sync, 'waiting');
  assert.equal(JSON.parse(raw(a)).themeStudio.borrowedApplied, true);
  s.setUiPreferences({ borrowNoticeSeen: true });
  await time.advance(550);
  assert.equal(lane(s).borrowed.inUse, true);
  assert.equal(host.control.snapshot().theme.tokens.primary, '#84284f');
  s.dispose();
  const b = fixture(t, { workspace, time });
  await b.studio.start();
  assert.equal(b.studio.getState().live.banner, null);
  assert.equal(lane(b.studio).recovery, null);
  assert.equal(b.studio.getState().uiPreferences.borrowNoticeSeen, true);
  assert.equal(lane(b.studio).borrowed.applied, true);
  assert.equal(lane(b.studio).borrowed.inUse, true);
  assert.equal((await b.studio.endTryOn()).ok, true);
  await time.advance(550);
  assert.equal(b.host.control.snapshot().theme.tokens.primary, original);
  assert.equal(lane(b.studio).borrowed, null);
  assert.equal(JSON.parse(raw(b)).themeStudio.borrowedApplied, undefined);
});

test('first open shares the directory probe and waits for a 5.265 s reply without writing', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  const stat = host.stat;
  let directoryReads = 0;
  host.stat = async (path) => {
    if (path === themesDir && ++directoryReads === 1) await later(time, 5265);
    return stat(path);
  };
  const boot = s.start();
  await time.advance(4500);
  const early = await s.apply();
  assert.equal(host.control.writes.length, 0);
  assert.equal(early.ok, false);
  assert.equal(lane(s).connection, 'checking');
  assert.equal(lane(s).active.id, 'openchamber-light');
  assert.equal(directoryReads, 1);
  await time.advance(765);
  await boot;
  assert.equal(host.control.writes.length, 0);
  assert.equal(lane(s).canTryOn, true);
  s.setOverride(path, '#1850a1');
  assert.equal((await s.apply()).mode, 'borrow');
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
  assert.equal(raw(f, 'dark'), undefined);
  await time.advance(550);
  assert.equal(host.control.snapshot().theme.tokens.primary, '#1850a1');
});

test('timed-out reads do not turn the old Apply or Retry into a fixed-slot write', async (t) => {
  const f = fixture(t), { studio: s, host } = f;
  const stat = host.stat;
  let unreadable = true, reads = 0;
  host.stat = async (path) => {
    if (path === themesDir) {
      reads++;
      if (unreadable) throw hostTimeout();
    }
    return stat(path);
  };
  await s.start();
  s.rename('Keep this draft');
  s.setOverride(path, '#6546b8');
  await s.flushDraft();
  const project = s.getState().project;
  unreadable = false; // The next transport read would succeed, but the slot is not verified yet.
  const staleApply = await s.apply();
  assert.deepEqual({ writes: host.control.writes.length, id: raw(f) && JSON.parse(raw(f)).metadata.id },
    { writes: 0, id: undefined }, 'old Apply used to write theme-studio-live-light');
  assert.equal(staleApply.ok, false);
  assert.equal(staleApply.stage, 'read');
  assert.equal(lane(s).connection, 'read-error');
  assert.equal(lane(s).active.id, 'openchamber-light');
  assert.equal(lane(s).canTryOn, false);
  assert.equal(reads, 2, 'one retry of the shared directory stat');
  assert.equal((await s.prepareSlot()).ok, false, 'the explicit slot API also fails closed');
  assert.equal(await s.copyJson(), true);
  assert.equal(color(JSON.parse(host.control.clipboard())), '#6546b8');
  const storageSet = host.storage.set;
  let storageWrites = 0;
  host.storage.set = (key, value) => { storageWrites++; return storageSet(key, value); };
  const [rechecked, legacy] = await Promise.all([s.recheck(), s.retry()]);
  assert.equal(rechecked.ok, true);
  assert.equal(legacy.ok, true);
  assert.equal(reads, 3, 'recheck and old Retry join the same read');
  assert.equal(host.control.writes.length, 0);
  assert.equal(storageWrites, 0, 'recheck does not even change saved draft or lease storage');
  assert.equal(s.getState().project, project);
  assert.equal(s.getState().dirty.light, true);
  assert.equal(lane(s).canTryOn, true);
  assert.equal((await s.apply()).mode, 'borrow');
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
});

test('Apply preflight retries only read timeouts and tolerates delayed slot content', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  await expectTry(f);
  s.setLive(false);
  s.setOverride(path, '#843179');
  const stat = host.stat, read = host.readFile;
  const count = host.control.writes.length;
  let directoryReads = 0, slotReads = 0;
  host.stat = async (path) => {
    if (path === themesDir && ++directoryReads === 1) {
      await later(time, 4500);
      throw hostTimeout();
    }
    return stat(path);
  };
  host.readFile = async (path) => {
    if (path === slotPath(variant) && ++slotReads === 1) await later(time, 5265);
    return read(path);
  };
  const applying = s.apply();
  await time.advance(9764);
  assert.equal(host.control.writes.length, count);
  assert.equal(lane(s).sync, 'preflight');
  await time.advance(1);
  const result = await applying;
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'borrow');
  assert.equal(directoryReads, 2);
  assert.equal(host.control.writes.length, count + 1);
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
  assert.equal(color(JSON.parse(raw(f))), '#843179');
});

test('a preflight read failure cannot mask another panel’s slot edit or replace the draft during recheck', async (t) => {
  const a = fixture(t), { workspace, time } = a;
  const b = fixture(t, { workspace, time });
  const { studio: s, host } = b;
  await Promise.all([a.studio.start(), s.start()]);
  const stat = host.stat;
  host.stat = async (path) => { if (path === slotPath(variant)) throw hostTimeout(); return stat(path); };
  s.rename('My draft');
  const refused = await s.apply();
  assert.equal(refused.stage, 'read');
  assert.equal(lane(s).connection, 'read-error');
  assert.equal(b.host.control.writes.length, 0);
  await a.studio.prepareSlot();
  host.stat = stat;
  const rechecked = await s.recheck();
  assert.equal(rechecked.code, 'CONFLICT');
  assert.equal(lane(s).connection, 'conflict');
  assert.equal(s.getState().project.name, 'My draft');
  assert.equal(b.host.control.writes.length, 0);
});

test('Apply confirms a trial and retries the failed borrowed write without treating it as a slot', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  await expectTry(f);
  assert.equal(lane(s).borrowed.applied, false);
  host.control.failWrite();
  const failure = await s.apply();
  assert.equal(failure.mode, 'borrow');
  assert.equal(failure.ok, false);
  assert.equal(lane(s).borrowed.applied, false);
  const retried = await s.retry();
  assert.equal(retried.mode, 'borrow');
  assert.equal(retried.ok, true);
  assert.equal(lane(s).borrowed.applied, true);
  assert.equal(s.getState().dirty.light, false);
  const transitioning = await s.prepareSlot('light');
  assert.equal(transitioning.mode, 'slot');
  await time.advance(550);
  assert.equal(host.control.snapshot().theme.tokens.primary, color(definitions['openchamber-light']));
  host.control.select(slotId(variant));
  assert.equal((await s.apply()).mode, 'live');
});

test('confirmed borrowed baseline wins after shutdown before storage acknowledgment, but later live edits are recoverable', async (t) => {
  const a = fixture(t), { studio: s, workspace, time } = a;
  await s.start();
  await s.apply();
  await time.advance(550);
  s.setOverride(path, '#8b2244');
  await time.advance(600);
  assert.equal((await s.apply()).ok, true);
  const current = JSON.parse(raw(a)).themeStudio;
  assert.equal(current.borrowBaseline, `${current.writer}/${current.rev}`);
  const storage = createPersistence(a.host.storage);
  // Represent the previous baseline surviving while the confirmed theme file
  // was atomically saved; don't rely on unobservable crash timing here.
  const old = normalizeProject({ ...current.project, overrides: { light: {}, dark: {} } });
  await storage.set('applied-light', old);
  s.dispose();
  const b = fixture(t, { workspace, time });
  await b.studio.start();
  assert.equal(b.studio.getState().live.banner, null);
  const restored = await b.studio.revert();
  assert.equal(restored.ok, true);
  assert.equal(field(b.studio), '#8b2244');
  await time.advance(550);
  b.studio.setOverride(path, '#5c214e');
  await time.advance(600);
  const changed = JSON.parse(raw(b)).themeStudio;
  assert.equal(color(JSON.parse(raw(b))), '#5c214e');
  assert.notEqual(changed.borrowBaseline, `${changed.writer}/${changed.rev}`);
  b.studio.dispose();
  const c = fixture(t, { workspace, time });
  await c.studio.start();
  assert.equal(c.studio.getState().live.banner.kind, 'unapplied-preview');
  assert.equal(await c.studio.keepPreview(), true);
  assert.equal(c.studio.getState().live.banner, null);
  c.studio.dispose();
  const d = fixture(t, { workspace, time });
  await d.studio.start();
  assert.equal(d.studio.getState().live.banner, null);
  assert.equal(field(d.studio), '#5c214e');
});

test('switching native theme while borrowed is observed and restoring removes only the borrow, not the new selection', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  colorful(s);
  await s.apply();
  await time.advance(550);
  assert.equal(lane(s).borrowed.inUse, true);
  host.control.select('flexoki-light');
  assert.equal(lane(s).borrowed.inUse, false);
  const result = await s.endTryOn();
  assert.equal(result.ok, true);
  assert.equal(result.observable, false);
  assert.equal(lane(s).sync, 'idle');
  await time.advance(550);
  assert.equal(host.control.snapshot().theme.tokens.primary, color(definitions['flexoki-light']));
  assert.equal(lane(s).borrowed, null);
});

test('the other variant only borrows on explicit Apply and each restores independently', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  colorful(s);
  await s.apply('light');
  await time.advance(550);
  host.control.setSystem('dark');
  assert.equal(lane(s, 'light').borrowed.inUse, null);
  assert.equal(lane(s, 'dark').canTryOn, true);
  assert.equal(raw(f, 'dark'), undefined);
  assert.equal((await s.apply('dark')).mode, 'borrow');
  await time.advance(550);
  assert.equal(lane(s, 'dark').borrowed.inUse, true);
  assert.equal((await s.endTryOn('light')).ok, true);
  assert.equal(lane(s, 'dark').borrowed.applied, true);
  assert.equal((await s.endTryOn('dark')).ok, true);
  await time.advance(550);
  assert.equal(host.control.snapshot().theme.tokens.primary, color(definitions['openchamber-dark']));
  host.control.setSystem('light');
  assert.equal(host.control.snapshot().theme.tokens.primary, color(definitions['openchamber-light']));
});

test('Apply on a hidden or unidentifiable surface writes only the private slot and never claims an observed update', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  const hidden = await s.apply('dark');
  assert.equal(hidden.mode, 'slot');
  assert.equal(hidden.observable, false);
  assert.equal(JSON.parse(raw(f, 'dark')).metadata.id, slotId('dark'));
  const snapshot = host.control.snapshot();
  host.control.push({ ...snapshot, theme: { ...snapshot.theme, tokens: { ...snapshot.theme.tokens, primary: '#123456' } } });
  assert.equal(lane(s, 'light').canTryOn, false);
  const unknown = await s.apply('light');
  assert.equal(unknown.mode, 'slot');
  assert.equal(unknown.observable, false);
  await time.advance(550);
  assert.equal(lane(s, 'light').borrowed, null);
});

test('a pending Apply does not use the slot if an unknown identity becomes a known built-in during preflight', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  const ready = host.control.snapshot();
  host.control.push({ ...ready, theme: { ...ready.theme, tokens: { ...ready.theme.tokens, primary: '#123456' } } });
  assert.equal(lane(s).active.kind, 'unknown');
  const stat = host.stat;
  host.stat = async (path) => { if (path === themesDir) await later(time, 5265); return stat(path); };
  const pending = s.apply();
  await time.advance(2000);
  host.control.push(ready);
  await time.advance(3265);
  assert.equal((await pending).code, 'MODE_CHANGED');
  assert.equal(host.control.writes.length, 0);
  assert.equal(lane(s).canTryOn, true);
  host.stat = stat;
  assert.equal((await s.apply()).mode, 'borrow');
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
});

test('coalesced linked drag leaves one undo item and one filesystem write', async (t) => {
  const f = fixture(t), { studio: s, time, host } = f;
  await s.start();
  await expectTry(f);
  const count = host.control.writes.length;
  const original = field(s);
  for (const next of ['#3c4660', '#336679', '#ac246e']) {
    s.setOverride(path, next, { phase: 'drag' });
    await time.advance(35);
  }
  s.setOverride(path, '#ac246e', { phase: 'commit' });
  assert.equal(field(s), '#ac246e');
  assert.equal(host.control.writes.length, count);
  await time.advance(150);
  assert.equal(host.control.writes.length, count + 1);
  s.undo();
  assert.equal(field(s), original);
  s.redo();
  assert.equal(field(s), '#ac246e');
  s.setTune({ global: { hue: 23 } }, { phase: 'commit' });
  assert.equal(s.getState().project.tune.dark.global.hue, 23);
});

test('system change mid-drag cancels outgoing lane scheduling and never tries the other mode implicitly', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  await expectTry(f);
  const n = host.control.writes.length;
  s.setOverride(path, '#234567', { phase: 'drag' });
  host.control.setSystem('dark');
  assert.equal(lane(s).connection, 'hidden');
  assert.equal(lane(s, 'dark').canTryOn, true);
  s.setOverride(path, '#345678', { phase: 'commit' });
  await time.advance(700);
  assert.equal(host.control.writes.length, n);
  assert.equal(raw(f, 'dark'), undefined);
  assert.equal((await s.tryOn('dark')).ok, true);
  assert.equal(JSON.parse(raw(f, 'dark')).metadata.id, 'openchamber-dark');
});

test('the production confirmation deadline stays waiting until it expires and accepts a later snapshot', async (t) => {
  const { host, time, studio: s } = fixture(t, { timing: { timeout: undefined } });
  await s.start();
  colorful(s);
  host.control.hold();
  await s.apply();
  await time.advance(THEME_CONFIRMATION_TIMEOUT_MS - 1);
  assert.equal(lane(s).sync, 'waiting');
  await time.advance(1);
  assert.equal(lane(s).sync, 'timeout');
  host.control.release();
  assert.equal(lane(s).sync, 'applied');
});

test('stale/duplicate snapshots cannot settle a different outgoing key; timeout then correct ready recovers', async (t) => {
  const f = fixture(t), { host, time, studio: s } = f;
  await s.start();
  const original = host.control.snapshot();
  colorful(s);
  host.control.hold();
  await s.tryOn(variant);
  host.control.push(original);
  host.control.push(original);
  await time.advance(1020);
  assert.equal(lane(s).sync, 'timeout');
  host.control.release();
  assert.equal(lane(s).sync, 'applied');
  host.control.push(original);
  assert.equal(lane(s).sync, 'idle');
  host.control.emit();
  assert.equal(lane(s).connection, 'tryon');
  assert.equal(s.getState().host.active.light.kind, 'tryon');
});

test('retry after timeout re-signals only the same on-disk color and does not apply a newer draft', async (t) => {
  const f = fixture(t), { studio: s, host, time } = f;
  await s.start();
  colorful(s);
  host.control.hold();
  const colorBeforeEdit = field(s);
  await s.apply();
  await time.advance(1050);
  assert.equal(lane(s).sync, 'timeout');
  s.setLive(false);
  s.setOverride(path, '#4c196a');
  assert.equal((await s.retry()).ok, true);
  assert.equal(lane(s).sync, 'waiting');
  assert.equal(host.control.writes.length, 2);
  assert.equal(color(JSON.parse(raw(f))), colorBeforeEdit);
  assert.equal(s.getState().dirty.light, true);
  await time.advance(550);
  host.control.release();
  assert.equal(lane(s).sync, 'applied');
  assert.equal(host.control.snapshot().theme.tokens.primary, colorBeforeEdit);
});

test('unchanged 24-token snapshot does not prove metadata-only try-on', async (t) => {
  const f = fixture(t), { studio: s, time } = f;
  await s.start();
  await s.loadBuiltin('openchamber');
  const result = await s.tryOn(variant);
  assert.equal(result.ok, true);
  assert.equal(result.observable, false);
  await time.advance(1000);
  assert.equal(lane(s).sync, 'idle');
  assert.equal(s.getState().host.active.light.kind, 'unknown');
});

test('preflight detects another writer and never clobbers a foreign file', async (t) => {
  const a = fixture(t), { workspace, time } = a;
  const b = fixture(t, { workspace, time });
  await Promise.all([a.studio.start(), b.studio.start()]);
  await expectTry(a);
  assert.equal((await b.studio.prepareSlot(variant)).code, 'CONFLICT');
  assert.equal(lane(b.studio).connection, 'conflict');
  assert.equal((await b.studio.resolveConflict(variant, 'load')).ok, true);
  assert.equal(lane(b.studio).doingTryOn, true);
  a.host.control.editFile(slotPath(variant), '{"foreignFile":true}');
  const result = await b.studio.resolveConflict(variant, 'overwrite');
  assert.equal(result.code, 'CONFLICT');
  assert.equal(raw(a), '{"foreignFile":true}');
});

test('simultaneous panels on same empty slot settle with one write under the advisory lease', async (t) => {
  const a = fixture(t, { timing: { settle: 30 } }), { workspace, time } = a;
  const b = fixture(t, { workspace, time, timing: { settle: 30 } });
  await Promise.all([a.studio.start(), b.studio.start()]);
  const pending = [a.studio.tryOn(variant), b.studio.tryOn(variant)];
  await time.advance(40);
  const reports = await Promise.all(pending);
  assert.equal(reports.filter((item) => item.ok).length, 1);
  assert.equal(a.host.control.writes.length + b.host.control.writes.length, 1);
  assert.equal(reports.find((item) => !item.ok).code, 'CONFLICT');
});

test('write failure preserves draft; explicit retry succeeds; failure after rename is not repeated', async (t) => {
  const f = fixture(t), { host, studio: s } = f;
  await s.start();
  host.control.failWrite();
  assert.equal((await s.tryOn(variant)).ok, false);
  assert.equal(lane(s).connection, 'error');
  assert.equal(raw(f), undefined);
  host.control.failWrite(undefined, { after: true });
  assert.equal((await s.tryOn(variant)).ok, true);
  assert.equal(host.control.writes.length, 1);
});

test('write retry preserves the requested built-in and exact draft even if the panel has since changed', async (t) => {
  const f = fixture(t), { host, studio: s } = f;
  await s.start();
  s.setLive(false);
  s.setOverride(path, '#963b24');
  host.control.failWrite();
  const failed = await s.apply();
  assert.equal(failed.stage, 'write');
  assert.equal(lane(s).connection, 'error');
  s.setOverride(path, '#963b25');
  host.control.select('flexoki-light');
  assert.equal((await s.retry()).code, 'MODE_CHANGED');
  assert.equal(host.control.writes.length, 0);
  host.control.select('openchamber-light');
  assert.equal((await s.retry()).mode, 'borrow');
  assert.equal(host.control.writes.length, 1);
  assert.equal(JSON.parse(raw(f)).metadata.id, 'openchamber-light');
  assert.equal(color(JSON.parse(raw(f))), '#963b24');
  assert.equal(field(s), '#963b25');
  assert.equal(s.getState().dirty.light, true);
});

test('a timed-out write with unreadable readback is verified on explicit Retry without a second write', async (t) => {
  const f = fixture(t), { host, studio: s, time } = f;
  await s.start();
  const read = host.readFile;
  let unreadable = true;
  host.readFile = async (path) => {
    if (path === slotPath(variant) && unreadable) throw hostTimeout();
    return read(path);
  };
  host.control.failWrite(hostTimeout(), { after: true });
  s.setOverride(path, '#76217c');
  const uncertain = await s.apply();
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.stage, 'verify');
  assert.equal(lane(s).connection, 'verify-error');
  assert.equal(host.control.writes.length, 1);
  await time.advance(550);
  s.setOverride(path, '#76217d');
  unreadable = false;
  assert.equal((await s.retry()).mode, 'borrow');
  assert.equal(host.control.writes.length, 1, 'previous write already landed');
  assert.equal(color(JSON.parse(raw(f))), '#76217c');
  assert.equal(lane(s).sync, 'applied');
  assert.equal(s.getState().dirty.light, true);
});

test('panel closure mid-write recovers on next boot without applying pending drafts blindly', async (t) => {
  const a = fixture(t, { writeDelay: 120 }), { time, workspace } = a;
  await a.studio.start();
  a.studio.rename('Interrupted');
  const inFlight = a.studio.tryOn(variant);
  await time.advance(60);
  a.studio.dispose();
  await time.advance(120);
  await inFlight;
  const b = fixture(t, { time, workspace });
  await b.studio.start();
  assert.equal(b.studio.getState().project.name, 'Interrupted');
  assert.equal(b.studio.getState().live.banner.kind, 'tryon-left');
  await b.studio.endTryOn(variant);
  assert.equal(JSON.parse(raw(b)).metadata.id, slotId(variant));
});

test('unapplied preview survives a remount and can be restored to the independent applied baseline', async (t) => {
  const a = fixture(t), { time, workspace, studio: s, host } = a;
  await s.start();
  colorful(s);
  await s.prepareSlot(variant);
  await time.advance(600);
  host.control.select(slotId(variant));
  const original = field(s);
  s.setOverride(path, '#dd4770');
  await time.advance(650);
  s.dispose();
  const b = fixture(t, { time, workspace, selected: { light: slotId(variant) } });
  await b.studio.start();
  assert.equal(b.studio.getState().live.banner.kind, 'unapplied-preview');
  assert.equal((await b.studio.revert()).ok, true);
  await time.advance(550);
  assert.equal(b.host.control.snapshot().theme.tokens.primary, original);
});

test('native deletion is not silently undone by edits', async (t) => {
  const f = fixture(t), { host, time, studio: s } = f;
  await s.start();
  await expectTry(f);
  host.control.deleteFile(slotPath(variant));
  await time.advance(600);
  s.setOverride(path, '#123456');
  await time.advance(150);
  assert.equal(raw(f), undefined);
  assert.ok(['conflict', 'tryon'].includes(lane(s).connection));
  assert.equal((await s.resolveConflict(variant, 'load')).ok, true);
  assert.equal(lane(s).connection, 'off');
});

test('missing filesystem grant and old host preserve panel edits and clipboard', async (t) => {
  const a = fixture(t, { granted: false });
  const stat = a.host.stat;
  let directoryReads = 0;
  a.host.stat = (path) => { if (path === themesDir) directoryReads++; return stat(path); };
  await a.studio.start();
  assert.equal(a.studio.getState().phase, 'degraded');
  assert.equal(lane(a.studio).connection, 'unavailable');
  assert.equal(lane(a.studio).readError.code, 'NOT_GRANTED');
  assert.equal((await a.studio.tryOn(variant)).code, 'NOT_GRANTED');
  assert.equal(directoryReads, 1, 'confirmed permission errors are not transport-retried');
  a.studio.setOverride(path, '#ac4467');
  assert.deepEqual(await a.studio.apply(), { ok: true, mode: 'copy', name: a.studio.getState().project.name });
  assert.equal(color(JSON.parse(a.host.control.clipboard())), '#ac4467');
  const missing = fixture(t, { directories: [] });
  await missing.studio.start();
  assert.equal(lane(missing.studio).connection, 'unavailable');
  assert.equal(lane(missing.studio).readError.code, 'NO_THEME_DIRECTORY');
  assert.equal(missing.host.control.writes.length, 0);
  const b = fixture(t, { oldHost: true });
  const started = b.studio.start();
  await b.time.advance(150);
  await started;
  assert.equal(b.studio.getState().phase, 'degraded');
  assert.equal(lane(b.studio).connection, 'unavailable');
  b.studio.rename('Local');
  assert.equal(b.studio.getState().project.name, 'Local');
  assert.equal(JSON.parse(b.studio.getJson()).metadata.name, 'Local');
});

test('save suffixes, safe exports, editable reimport, and recovery of library after uninstall', async (t) => {
  const a = fixture(t, { directories: ['~/.config/openchamber/themes'], locale: 'zh' }), { studio: s, workspace, time } = a;
  await s.start();
  const empty = await s.exportFiles({ variants: ['light'] });
  assert.equal(empty.code, 'NO_DOWNLOAD_DIRECTORY');
  assert.equal(workspace.dir.has('~/Downloads'), false);
  assert.equal(workspace.dir.has('~/下载'), false);
  workspace.dir.add('~/下载');
  const saved = await s.saveAs({ name: '测试作品', variants: ['light', 'dark'] });
  assert.equal(saved.ok, true);
  const sibling = await s.saveAs({ name: '测试作品', variants: ['light'] });
  assert.match(sibling.files[0].id, /-2-light$/u);
  const exported = await s.exportFiles({ variants: ['dark'] });
  assert.match(exported.paths[0], /^~\/下载\//u);
  const report = s.importText(workspace.files.get(exported.paths[0]).content, 'demo.json');
  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.variant, 'dark');
  assert.equal(s.importText('{"colors":{"editor.background":"#fff"}}').code, 'VSCODE_THEME');
  a.studio.dispose();
  await time.advance(100);
  workspace.uninstall();
  const b = fixture(t, { workspace, time });
  await b.studio.start();
  await runMicrotasks();
  assert.equal(b.studio.getState().library.saved.length, 2);
  assert.equal(await b.studio.loadSaved(saved.files[0].id), true);
  assert.equal(b.studio.getState().project.name, '测试作品');
});

test('concurrent saves never silently replace a sibling panel project', async (t) => {
  const a = fixture(t, { timing: { settle: 30 } }), { workspace, time } = a;
  const b = fixture(t, { workspace, time, timing: { settle: 30 } });
  await Promise.all([a.studio.start(), b.studio.start()]);
  const reports = [a.studio.saveAs({ name: 'Same', variants: ['light'] }), b.studio.saveAs({ name: 'Same', variants: ['light'] })];
  await time.advance(60);
  const results = await Promise.all(reports);
  assert.equal(results.filter((report) => report.ok).length, 1);
  assert.equal(results.find((report) => !report.ok).code, 'CONFLICT');
  assert.equal(workspace.files.size, 1);
});

test('native import reports unsupported keys and falls back to native colors for a stale editable sidecar', async (t) => {
  const { studio: s } = fixture(t);
  const value = JSON.parse(s.getJson());
  value.colors.primary.base = '#9c2841';
  value.colors.primary.unsupported = 'test';
  value.extra = 'test';
  const result = s.importText(JSON.stringify(value), 'edited.json');
  assert.equal(result.ok, true);
  assert.equal(field(s), '#9c2841');
  assert.deepEqual(result.warnings.map(({ path }) => path.join('.')).sort(), ['colors.primary.unsupported', 'extra', 'themeStudio']);
});

test('storage chunks preserve Unicode and roll back if quota is exceeded', async (t) => {
  const { host } = fixture(t, { maxStorage: 290_000 });
  const store = createPersistence(host.storage);
  const message = '悬空𠮷\\"\\r'.repeat(9000);
  await store.set('draft', message);
  assert.equal(await store.get('draft'), message);
  await assert.rejects(store.set('draft', '夜'.repeat(80_000)), /quota/i);
  assert.equal(await store.get('draft'), message);
  await store.set('draft', 'smaller');
  assert.equal(await store.get('draft'), 'smaller');
  assert.equal((await host.storage.keys()).length, 1);
});

test('non-destructive property: normalized and reimported layered overrides preserve CSS and theme fingerprint', async (t) => {
  const { studio: s } = fixture(t);
  const initial = s.getState().project;
  for (let n = 0; n < 17; n++) {
    const v = n % 2 === 0 ? 'light' : 'dark';
    const accent = `#${(0x312e53 + n * 1299).toString(16)}`;
    s.setVariant(v);
    s.setOverride(path, accent);
    s.loadPreset(n % 2 ? 'wheat-vellum' : 'blue-etch');
    const project = normalizeProject(s.getState().project);
    const resolved = resolveProject(project, v, { compact: false });
    const content = encodeTheme(resolved, project, { id: slotId(v), name: project.name, writer: 'test', rev: n + 1 });
    const decoded = decodeOwned(content, v);
    assert.equal(decoded.key, themeKey(resolved));
    assert.equal(color(resolveProject(decoded.project, v)), accent);
    assert.notEqual(decoded.project.base, initial.base);
  }
  assert.ok(Object.isFrozen(s.getState().project.overrides.light));
});

test('history bounds entries, merges by control and time and invalidates redo after new edit', () => {
  let now = 0;
  const h = createHistory({ max: 3, now: () => now });
  h.record(0, 1, { key: 'a' });
  now += 45;
  h.record(1, 2, { key: 'a' });
  for (let i = 2; i <= 5; ++i) h.record(i, i + 1, { key: `b${i}` });
  assert.equal(h.undo(6), 5);
  assert.equal(h.undo(5), 4);
  assert.equal(h.undo(4), 3);
  assert.equal(h.state().canUndo, false);
  h.record(3, 11, { key: 'fresh' });
  assert.equal(h.state().canRedo, false);
});
