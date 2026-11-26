// First open, from the real permission prompt. Use a new private web fixture
// (--default-data-dir --manual-install) per run. The optional latency control
// delays only successful directory stat replies; it does not replace their data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { openFixture, openExtension, repo } from './dev-browser.mjs';
import { TOKEN_PATHS, tokenKey } from '../src/host/identify.mjs';

const [name, control = 'ordinary', candidate, expectedJS, ...extra] = process.argv.slice(2);
assert.match(name ?? '', /^lead-first-w\d{1,2}$/u);
assert.ok(['ordinary', 'sidebar-toggle', 'late-stat', 'late-preflight', 'late-recheck'].includes(control));
assert.equal(extra.length, 0);
if (candidate !== undefined) {
  assert.match(candidate, /^(?:root|i1-[a-z0-9-]{1,36})$/u);
  assert.match(expectedJS ?? '', /^[a-f0-9]{64}$/u, 'the candidate requires an independently recorded main.js SHA-256');
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = Object.fromEntries((await readFile(join(repo, 'docs/research/evidence/package-0.1.0.sha256'), 'utf8'))
  .trim().split('\n').map((row) => row.split('  ').reverse()));
const source = !candidate || candidate === 'root' ? repo : join(repo, '.dev-host/packages', candidate);
const builtins = JSON.parse(await readFile(join(repo, 'src/data/builtin-index.json')));
const app = await openFixture(name);
const { context, page, state } = app;
const file = join(repo, 'docs/research/evidence', `${name}-${control}.json`);
const out = { fixture: name, control, times: {}, observations: [] };
const start = Date.now();
const at = () => Date.now() - start;
const observe = (stage, value) => out.observations.push({ stage, ms: at(), ...value });
const btn = (root, label) => root.getByRole('button', { name: label, exact: true });
const tab = (root, label) => root.getByRole('tab', { name: label, exact: true });
let panel;
try {
  assert.equal(state.mode, 'web');
  assert.equal(state.defaultDataDir, true);
  assert.ok(state.openchamberData.startsWith(join(repo, '.dev-host/instances', name, 'box') + '/'));
  assert.notEqual(new URL(state.url).port, '57123');
  const packageHashes = {};
  for (const [path, originalHash] of Object.entries(manifest)) {
    const sourceHash = sha(await readFile(join(source, path)));
    if (!candidate) assert.equal(sourceHash, originalHash, path);
    assert.equal(sha(await readFile(join(state.dir, 'extension', path))), sourceHash, path);
    packageHashes[path] = sourceHash;
  }
  out.bundle = packageHashes['panel/main.js'];
  if (candidate) {
    assert.equal(out.bundle, expectedJS);
    out.candidate = { source: candidate, packageHashes };
  }
  const themes = join(state.openchamberData, 'themes');
  const slot = join(themes, 'theme-studio-live-light.json');
  async function disk() {
    try {
      const t = JSON.parse(await readFile(slot, 'utf8'));
      return { id: t.metadata.id, primary: t.colors.primary.base, rev: t.themeStudio?.rev };
    } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  }
  const accent = () => page.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--primary-base').trim());
  const ui = async () => panel.locator('.studio-foot').evaluate((el) => {
    const connection = document.querySelector('.connection');
    return { status: connection?.querySelector('[role=status]')?.textContent ?? connection?.textContent,
      actions: Array.from(document.querySelectorAll('.status-actions button'), (b) => b.textContent),
      footer: el.querySelector('.footer-apply')?.textContent, disabled: el.querySelector('.footer-apply')?.disabled };
  });
  // Listen passively on both sides of the fixture's SDK. No messages sent,
  // no request bodies, grant URLs, storage values or session data recorded.
  const tracer = (names) => {
    if (globalThis.tsFirstTrace) return;
    globalThis.tsFirstTrace = [];
    addEventListener('message', ({ data: m }) => {
      if (m?.channel !== 'openchamber.sdk' || globalThis.tsFirstTrace.length >= 500) return;
      const row = { t: Date.now(), type: m.type, id: m.id };
      if (m.type === 'ready') {
        const t = m.payload?.theme;
        Object.assign(row, { mode: t?.mode, colors: Object.fromEntries(names.map((n) => [n, t?.tokens?.[n] ?? null])) });
      } else if (typeof m.ok === 'boolean') {
        Object.assign(row, { ok: m.ok, code: m.code, kind: m.result?.kind });
      } else if (/^(file-|storage-)/u.test(m.type)) {
        const path = m.payload?.path;
        if (path?.endsWith('/themes')) row.target = 'theme-dir';
        else if (/theme-studio-live-(light|dark)\.json$/u.test(path)) row.target = path.split('/').at(-1);
      } else return;
      globalThis.tsFirstTrace.push(row);
    });
  };
  const names = Object.keys(TOKEN_PATHS);
  await page.evaluate(tracer, names);
  await context.addInitScript(tracer, names);
  const catalog = [];
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname !== '/api/config/themes' || !response.ok()
      || response.request().method() !== 'GET') return;
    try {
      const { themes: rows } = await response.json();
      const found = (rows ?? []).find((t) => t.metadata?.id === 'theme-studio-live-light');
      if (found) catalog.push({ ms: at(), id: found.metadata.id, primary: found.colors?.primary?.base });
    } catch { /* A closed page or unrelated response is not a reload receipt. */ }
  });
  let delayed = 0, firstStatAt, applyStarted = false, allowRecheck = false;
  if (['late-stat', 'late-preflight', 'late-recheck'].includes(control)) {
    await page.route(`${state.url}/api/guests/theme-studio/files`, async (route) => {
      const body = route.request().postDataJSON();
      if (body?.op !== 'stat' || !body.path?.endsWith('/themes')) return route.fallback();
      if (control === 'late-recheck') {
        if (!allowRecheck) {
          delayed++;
          const response = await route.fetch();
          await wait(8500);
          return route.fulfill({ response });
        }
      } else if (control === 'late-preflight' ? applyStarted : !applyStarted) {
        firstStatAt ??= Date.now();
        // Delay the first batch only, not a recovery check several seconds later.
        if (Date.now() - firstStatAt < 500 && delayed < (control === 'late-preflight' ? 1 : 2)) {
          delayed++;
          const response = await route.fetch();
          await wait(5200);
          return route.fulfill({ response });
        }
      }
      return route.fallback();
    });
  }
  page.setDefaultTimeout(10_000);
  assert.deepEqual(await readdir(themes), []);
  const original = await accent();
  await btn(page, 'Settings').click();
  await btn(page, 'Extensions').click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  const prompt = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  await prompt.waitFor();
  await btn(prompt, 'Allow and enable').click();
  out.times.approved = at();
  await btn(page, 'Close settings').click();
  panel = await openExtension(page, 'Theme Studio');
  await tab(panel, 'Theme').waitFor();
  if (control === 'sidebar-toggle') {
    const sidebar = btn(page, 'Toggle work-status panel');
    await sidebar.click();
    await sidebar.click();
  }
  await btn(panel, 'Use Wheat Vellum').waitFor({ timeout: control === 'late-recheck' ? 25_000 : 10_000 });
  observe('first-open-before-edit', { ui: await ui(), files: await readdir(themes), accent: await accent() });
  const closeGuide = btn(panel, 'Dismiss getting started');
  if (await closeGuide.isVisible()) await closeGuide.click();
  await btn(panel, 'Use Wheat Vellum').click();
  await tab(panel, 'Style').click();
  await btn(panel, 'Use Brutalism').click();
  await tab(panel, 'Pairings').click();
  await panel.getByRole('combobox', { name: /Try a family installed on this device/u }).first().fill('serif');
  const preview = await panel.getByRole('group', { name: 'Preview samples' })
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--v-primary').trim());
  assert.notEqual(original, preview);
  const beforeApply = await ui();
  observe('before-first-apply', { ui: beforeApply, files: await readdir(themes), original, preview, accent: await accent() });
  // Don't gate the click on "Try in the app", since its absence is the bug
  // under investigation. Only click the actual, enabled primary Apply.
  const apply = btn(panel.locator('footer'), 'Apply');
  if (control === 'late-recheck') {
    const recheck = btn(panel, 'Check files again');
    if (await recheck.isVisible()) {
      allowRecheck = true;
      out.times.recheck = at();
      await recheck.click();
      await apply.and(panel.locator('footer button:enabled')).waitFor({ timeout: 18_000 }).catch(() => {});
      observe('after-explicit-read-only-recheck', {
        ui: await ui(), files: await readdir(themes), accent: await accent(),
        preview: await panel.getByRole('group', { name: 'Preview samples' })
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--v-primary').trim()),
      });
    }
  }
  if (!await apply.isVisible() || !await apply.isEnabled()) {
    // Allow a pending read to recover without relaunching, discarding edits
    // or pressing any fallback action. Still record a panel that never recovers.
    await apply.and(panel.locator('footer button:enabled')).waitFor({ timeout: 18_000 }).catch(() => {});
    observe('after-waiting-for-first-enabled-apply', {
      ui: await ui(), files: await readdir(themes), accent: await accent(),
      preview: await panel.getByRole('group', { name: 'Preview samples' })
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--v-primary').trim()),
    });
  }
  if (await apply.isVisible() && await apply.isEnabled()) {
    applyStarted = true;
    out.times.clicked = at();
    await apply.click();
    const deadline = Date.now() + 15_000;
    let record;
    do { record = await disk(); if (record) break; await wait(80); } while (Date.now() < deadline);
    let changed = false;
    if (record?.id === 'openchamber-light') {
      changed = await page.waitForFunction((hex) => getComputedStyle(document.documentElement)
        .getPropertyValue('--primary-base').trim() === hex, preview, { timeout: 18_000 }).then(() => true, () => false);
    }
    observe('after-first-apply', { record, changed, ui: await ui(), accent: await accent() });
    if (record?.id === 'theme-studio-live-light') {
      // Observe the host's OWN GET and two paint frames afterwards. Don't
      // conflate preparing a personal slot with a slow switch to a built-in.
      const limit = Date.now() + 18_000;
      while (!catalog.some((entry) => entry.primary === preview) && Date.now() < limit) await wait(100);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      observe('personal-slot-after-watching-native-reload', {
        receipt: catalog.find((entry) => entry.primary === preview) ?? null, ui: await ui(), accent: await accent(),
      });
    }
    if (record?.id === 'openchamber-light' && changed) {
      await btn(panel, 'Restore original theme').click();
      await page.waitForFunction((hex) => getComputedStyle(document.documentElement)
        .getPropertyValue('--primary-base').trim() === hex, original, { timeout: 18_000 });
      observe('restored', { accent: await accent(), record: await disk() });
    }
  }
  out.delayCount = delayed;
  const requests = await page.evaluate(() => globalThis.tsFirstTrace);
  const replies = await panel.locator('body').evaluate(() => globalThis.tsFirstTrace);
  out.ready = replies.filter((x) => x.type === 'ready').map(({ t, mode, colors }) => ({
    ms: t - start, mode, present: Object.values(colors).filter(Boolean).length,
    matched: builtins.flatMap((b) => b.variants[mode]?.key === tokenKey(colors) ? [b.variants[mode].id] : []),
  }));
  out.sdk = requests.filter((x) => /^(file-|storage-)/u.test(x.type)).map(({ t, type, id, target }) => {
    const reply = replies.find((x) => x.id === id && typeof x.ok === 'boolean');
    return { ms: t - start, type, target, replyMs: reply ? reply.t - t : null, ok: reply?.ok, code: reply?.code };
  });
} catch (e) {
  out.driverError = String(e.message).replace(/\x1b\[[0-9;]*m/gu, '').slice(0, 600);
  process.exitCode = 1;
} finally {
  await app.close();
  await writeFile(out.driverError ? file.replace(/\.json$/u, `-driver-${start}.json`) : file,
    JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ name, control, delayCount: out.delayCount, observations: out.observations, error: out.driverError }));
}
