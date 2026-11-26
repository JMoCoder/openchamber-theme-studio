#!/usr/bin/env node
// More invasive lifecycle assertions use only this dedicated probe instance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import '../panel/builtins.js';
import { builtinCandidates } from '../src/data/index.mjs';
import { identifyTheme, themeKey } from '../src/host/identify.mjs';
import { closeAppearance, cssAccent, enterAppearance, observeThemeEvents, reloadWithEvents, removeTheme, showThemeVariant, themeRow, waitAccent, accentOf, warmFixtureWatcher } from './workshop-browser.mjs';
import { openExtension, openFixture, repo } from './dev-browser.mjs';

const name = process.argv[2] ?? 'i1-probe';
if (!name.startsWith('i1-')) throw new Error('use a dedicated i1-* fixture');
const title = 'Theme Studio Filesystem Probe';
const extension = 'theme-studio-scoped-fs-probe';
const definitions = globalThis.__themeStudioBuiltins;
const nameFor = (v) => `theme-studio-live-${v}`;
const hostControl = (command, ...args) => execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), command, '--name', name, ...args], { encoding: 'utf8' });
const body = { builtinCatalog: { total: builtinCandidates.length,
  unique: new Set(builtinCandidates.map((candidate) => `${candidate.variant}${candidate.key}`)).size },
  trials: [], identification: [] };
const ids = ['openchamber-light', 'flexoki-light', 'openchamber-dark', 'flexoki-dark'];
let f = await openFixture(name), panel;
let events, readiness;
assert.equal(f.state.defaultDataDir, true);
const mode = f.state.mode;
body.mode = mode;
const themeDir = join(f.state.openchamberData, 'themes');
const source = join(repo, 'scripts/fixtures/scoped-fs');
const ordinary = 'theme-studio-identity-saved-light';
const themes = new Set([nameFor('light'), nameFor('dark'), ordinary]);
const bytes = (id) => readFile(join(themeDir, `${id}.json`), 'utf8');
const api = async (path, method = 'GET') => {
  const response = await fetch(`${f.state.url}${path}`, { method, headers: { Origin: f.state.url } });
  return { status: response.status, value: response.status === 204 ? null : await response.json() };
};
async function inPanel() {
  panel = await openExtension(f.page, title);
  await panel.locator('#ready').getByText('ready', { exact: true }).waitFor();
}
const ready = () => panel.locator('body').evaluate(() => globalThis.ocFixture.ready.theme);
const identify = (extra = []) => ready().then((theme) => identifyTheme(theme, [...builtinCandidates, ...extra]));
async function write(id, theme) {
  assert.ok(themes.has(id), 'fixture-only file');
  const content = `${JSON.stringify(theme)}\n`;
  const path = join(themeDir, `${id}.json`);
  // The scoped filesystem transport is covered separately. Isolate the native
  // watcher behavior here from a frame grant being recreated by settings.
  await writeFile(`${path}.fixture.tmp`, content);
  await rename(`${path}.fixture.tmp`, path);
  assert.equal(await bytes(id), content);
  return content;
}
function altered(id, themeId, accent, label) {
  const base = structuredClone(definitions[themeId]);
  return { ...base, metadata: { ...base.metadata, id, name: label },
    colors: { ...base.colors, primary: { ...base.colors.primary, base: accent } },
    themeStudio: { schemaVersion: 1, probeOnly: true } };
}
async function choose(id) {
  const v = definitions[id]?.metadata.variant ?? 'light';
  await f.page.emulateMedia({ colorScheme: v });
  await enterAppearance(f.page);
  await showThemeVariant(f.page, v);
  await themeRow(f.page, id).click({ timeout: 6000 });
  if (definitions[id]) await waitAccent(f.page, accentOf(definitions[id]));
  await closeAppearance(f.page);
  await inPanel();
}
async function waitReady(primary) {
  for (let i = 0; i < 100; ++i) {
    const readyTheme = await ready();
    if (readyTheme.tokens.primary === primary) return readyTheme;
    await wait(45);
  }
  throw new Error(`no SDK snapshot with ${primary}`);
}
async function modePref() {
  return f.page.evaluate(() => {
    const k = Object.keys(localStorage).find((key) => key.startsWith('openchamber.theme.v2:'));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
}

try {
  if (mode === 'web') await reloadWithEvents(f.page);
  events = await observeThemeEvents(f.state.url);
  readiness = await warmFixtureWatcher(f.state, events);
  await inPanel();
  const warnings = [];
  f.page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && /themeStudio|invalid theme|theme schema/i.test(message.text())) warnings.push(message.text());
  });
  const otherContext = f.newContext && await f.newContext({ colorScheme: 'light' });
  const other = otherContext && await otherContext.newPage();
  if (other) {
    await other.goto(f.state.url, { waitUntil: 'domcontentloaded' });
    await enterAppearance(other);
    await showThemeVariant(other, 'light');
    await themeRow(other, 'openchamber-light').click({ timeout: 6000 });
    await closeAppearance(other);
    await waitAccent(other, accentOf(definitions['openchamber-light']));
    await f.page.bringToFront();
  }
  for (const [i, id] of ids.entries()) {
    const original = definitions[id], variant = original.metadata.variant;
    await choose(id);
    const initial = await cssAccent(f.page);
    await waitReady(initial);
    let match = await identify();
    assert.equal(match.id, id);
    body.identification.push({ id, kind: match.kind, actual: initial });
    const filename = nameFor(variant);
    const accent = ['#d83472', '#a34c8c', '#f379d2', '#9466de'][i];
    const slot = altered(filename, id, accent, `Theme Studio · Probe ${id}`);
    const trial = { ...slot, metadata: { ...slot.metadata, id, name: `${slot.metadata.name} (trying on)` } };
    const slotBytes = await write(filename, slot);
    await enterAppearance(f.page);
    await themeRow(f.page, filename).waitFor({ timeout: 6500 });
    await closeAppearance(f.page);
    await waitAccent(f.page, initial);
    const trialStart = performance.now();
    const trialBytes = await write(filename, trial);
    await waitAccent(f.page, accent);
    await waitReady(accent);
    const trialMs = Math.round(performance.now() - trialStart);
    const response = await api('/api/config/themes');
    assert.equal(response.value.themes.find((entry) => entry.metadata.id === id)?.themeStudio?.schemaVersion, 1);
    assert.equal(await bytes(filename), trialBytes);
    await enterAppearance(f.page);
    const row = themeRow(f.page, id);
    assert.match(await row.innerText(), /trying on/iu);
    const removable = await row.getByRole('button', { name: /delete|remove/i }).count() === 1;
    await closeAppearance(f.page);
    await inPanel();
    if (i === 0 && other) {
      await waitAccent(other, accent);
      body.anotherClientOnSameId = await cssAccent(other);
      const dark = await f.newContext({ colorScheme: 'dark' });
      const independentDark = await dark.newPage();
      await independentDark.goto(f.state.url, { waitUntil: 'domcontentloaded' });
      await waitAccent(independentDark, accentOf(definitions['openchamber-dark']));
      body.independentSystemDark = await cssAccent(independentDark);
      await dark.close();
    }
    const restoreStart = performance.now();
    assert.equal(await write(filename, slot), slotBytes);
    await waitAccent(f.page, initial);
    await waitReady(initial);
    assert.equal((await identify()).id, id);
    body.trials.push({ id, variant, changedFrom: initial, changedTo: accent, trialMs, restoreMs: Math.round(performance.now() - restoreStart), removable });
    if (i === 0 && other) {
      await waitAccent(other, initial);
      body.anotherClientRestored = await cssAccent(other);
    }
  }
  await otherContext?.close();

  await f.page.emulateMedia({ colorScheme: 'light' });
  await enterAppearance(f.page);
  await f.page.getByRole('radio', { name: 'System', exact: true }).click();
  await closeAppearance(f.page);
  const lightSlot = altered(nameFor('light'), 'openchamber-light', '#ad29d7', 'CLI slot marker');
  await write(nameFor('light'), lightSlot);
  await choose(nameFor('light'));
  await waitAccent(f.page, '#ad29d7');
  await waitReady('#ad29d7');
  const candidate = (definition, kind) => ({ id: definition.metadata.id, name: definition.metadata.name, variant: 'light', key: themeKey(definition), kind });
  assert.equal((await identify()).kind, 'unknown');
  assert.equal((await identify([candidate(lightSlot, 'slot')])).id, lightSlot.metadata.id);
  body.identification.push({ id: lightSlot.metadata.id, kind: 'slot', actual: '#ad29d7' });
  const saved = altered(ordinary, 'openchamber-light', '#237a8f', 'CLI saved marker');
  await write(ordinary, saved);
  await choose(ordinary);
  await waitAccent(f.page, '#237a8f');
  await waitReady('#237a8f');
  assert.equal((await identify()).kind, 'unknown');
  assert.equal((await identify([candidate(saved, 'saved')])).id, ordinary);
  assert.equal((await identify([candidate(saved, 'saved'), { ...candidate(saved, 'slot'), id: 'ambiguous' }])).reason, 'ambiguous');
  body.identification.push({ id: ordinary, kind: 'saved', actual: '#237a8f', ambiguityIsUnknown: true });

  // Keep both overrides on disk at once, then switch actual effective mode.
  await choose('openchamber-dark');
  const dTrial = altered('openchamber-dark', 'openchamber-dark', '#ee699e', 'Trial dark');
  await write(nameFor('dark'), dTrial);
  await waitAccent(f.page, '#ee699e');
  await choose('openchamber-light');
  const lTrial = altered('openchamber-light', 'openchamber-light', '#ad3a9e', 'Trial light');
  const lRaw = await write(nameFor('light'), lTrial);
  await waitAccent(f.page, '#ad3a9e');
  await f.page.emulateMedia({ colorScheme: 'dark' });
  await waitAccent(f.page, '#ee699e');
  await f.page.emulateMedia({ colorScheme: 'light' });
  await waitAccent(f.page, '#ad3a9e');
  body.systemToggle = { preferences: await modePref(), light: '#ad3a9e', dark: '#ee699e' };

  // Restart leaves the native override. Uninstall only removes the extension, not the theme.
  events.stop();
  await f.close();
  hostControl('stop');
  hostControl('start', '--default-data-dir', '--extension', source, ...(mode === 'desktop' ? ['--desktop'] : []));
  f = await openFixture(name);
  await waitAccent(f.page, '#ad3a9e');
  events = await observeThemeEvents(f.state.url);
  await readiness.close();
  readiness = await warmFixtureWatcher(f.state, events);
  assert.equal(await bytes(nameFor('light')), lRaw);
  body.restart = { css: await cssAccent(f.page), sameBytes: true };
  assert.equal((await api(`/api/guests/${extension}`, 'DELETE')).status, 204);
  await f.page.reload({ waitUntil: 'domcontentloaded' });
  await waitAccent(f.page, '#ad3a9e');
  assert.equal(await bytes(nameFor('light')), lRaw);
  body.uninstall = { css: await cssAccent(f.page), sameBytes: true };

  // Use the native remove button while a non-default builtin is overridden.
  hostControl('reload', '--extension', source);
  if (mode === 'web') await reloadWithEvents(f.page);
  else await f.page.reload({ waitUntil: 'domcontentloaded' });
  await choose('flexoki-light');
  await wait(1000);
  const deletion = altered('flexoki-light', 'flexoki-light', '#8c2242', 'Deleting trial');
  await write(nameFor('light'), deletion);
  await waitAccent(f.page, '#8c2242').catch(async (error) => {
    throw new Error(`${error.message}; actual ${await cssAccent(f.page)}; ${JSON.stringify(await modePref())}`);
  });
  await enterAppearance(f.page);
  await removeTheme(f.page, 'flexoki-light');
  await waitAccent(f.page, accentOf(definitions['openchamber-light']));
  const fallback = await modePref();
  assert.equal(await stat(join(themeDir, `${nameFor('light')}.json`)).then(() => true, () => false), false);
  body.nativeDelete = { id: 'flexoki-light', fallback, css: await cssAccent(f.page), removedFile: true };
  body.sidecar = { responseKeeps: true, diskPreserved: true, warnings };
} catch (error) {
  body.incomplete = error.message;
  throw error;
} finally {
  events?.stop();
  await readiness?.close();
  await writeFile(join(repo, `docs/research/evidence/workshop-identities-${mode}.json`), `${JSON.stringify(body, null, 2)}\n`);
  await f.close();
  for (const id of themes) {
    await rm(join(themeDir, `${id}.json`), { force: true });
    await rm(join(themeDir, `${id}.json.fixture.tmp`), { force: true });
  }
  hostControl('stop');
}
console.log(JSON.stringify(body, null, 2));
