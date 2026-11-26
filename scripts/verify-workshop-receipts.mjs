#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { THEME_CONFIRMATION_TIMEOUT_MS } from '../src/host/live.mjs';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { accentOf, cssAccent, observeThemeEvents, waitAccent } from './workshop-browser.mjs';

const [name, scenario = 'repeat', idle = '0'] = process.argv.slice(2);
assert.match(name, /^i1-[a-z0-9-]+$/u, 'dedicated named isolated fixture only');
assert.ok(['first', 'repeat', 'safety', 'retry'].includes(scenario), 'first, repeat, safety, or retry');
assert.ok(['0', '45000'].includes(idle) && (scenario === 'first' || idle === '0'), 'idle compare: first [0|45000]');
const idleBeforeBrowserMs = Number(idle);
const fault = scenario === 'safety' || scenario === 'retry';
const fixture = join(repo, '.dev-host', 'instances', name);
const setupWrittenMs = (await stat(join(fixture, 'instance.json'))).mtimeMs;
if (idleBeforeBrowserMs) await wait(idleBeforeBrowserMs);
const f = await openFixture(name);
const { page, state } = f;
assert.equal(state.defaultDataDir, true);
const themes = join(state.openchamberData, 'themes');
assert.ok(themes.includes('/.dev-host/instances/'));
const parked = `${themes}.safety-test`;
const path = join(themes, 'theme-studio-live-light.json');
const report = { host: state.mode, scenario, idleBeforeBrowserMs, appTimeoutMs: THEME_CONFIRMATION_TIMEOUT_MS, results: [] };
const monitor = await observeThemeEvents(state.url);
let moved = false;

const file = () => readFile(path, 'utf8').then(JSON.parse, (e) => { if (e.code === 'ENOENT') return null; throw e; });
async function until(predicate, duration) {
  const limit = performance.now() + duration;
  do {
    const value = await predicate();
    if (value) return value;
    await wait(75);
  } while (performance.now() < limit);
  return null;
}
try {
  assert.deepEqual(await readdir(themes), [], 'fresh isolated theme directory');
  await page.emulateMedia({ colorScheme: 'light' });
  const panel = await openExtension(page, 'Theme Studio');
  const status = panel.locator('.connection');
  const apply = panel.locator('.studio-foot [data-act=apply]');
  const restore = panel.locator('.status-actions [data-act=end-try-on]');
  const retry = panel.locator('.status-actions [data-act=retry]');
  await status.filter({ hasNotText: /^Connecting/iu }).waitFor({ timeout: 6500 });
  const original = await cssAccent(page);
  const reads = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/config/themes' && response.ok()) reads.push(performance.now());
  });
  // Observe only message types/reply codes in a synthetic browser. Never save
  // request bodies, guest grant URLs, tokens, user project paths or raw logs.
  await page.evaluate(() => {
    globalThis.fixtureFsRequests = [];
    addEventListener('message', ({ data }) => {
      if (data?.channel === 'openchamber.sdk' && /^file-|^storage-/u.test(data.type)) {
        globalThis.fixtureFsRequests.push({ type: data.type, id: data.id });
      }
    });
  });
  await panel.locator('body').evaluate(() => {
    globalThis.fixtureFsReplies = [];
    addEventListener('message', ({ data }) => {
      if (data?.channel === 'openchamber.sdk' && typeof data.ok === 'boolean') {
        globalThis.fixtureFsReplies.push({ id: data.id, ok: data.ok, ...(data.code ? { code: data.code } : {}) });
      }
    });
  });
  const messages = async () => ({
    request: await page.evaluate(() => globalThis.fixtureFsRequests),
    reply: await panel.locator('body').evaluate(() => globalThis.fixtureFsReplies),
  });

  if (fault) {
    // Replace only the test directory. Inotify is still attached to the old
    // inode until the upstream 30 s safety tick re-arms it. No server code,
    // production extension, connection or real profile is patched.
    await rename(themes, parked);
    moved = true;
    await mkdir(themes);
    await wait(2600);
  }

  for (let i = 1; i <= (scenario === 'repeat' ? 6 : 1); i++) {
    const noChange = monitor.count(), readsBefore = reads.length, old = await messages();
    const started = performance.now();
    const sample = { i, msAfterFixtureStart: Math.round(Date.now() - setupWrittenMs) };
    report.results.push(sample);
    const duration = () => Math.round(performance.now() - started);
    await apply.press('Enter', { timeout: 5000 });
    const record = await until(async () => {
      const value = await file();
      return value?.metadata.id === 'openchamber-light' ? value : null;
    }, 7500);
    sample.diskMs = record ? duration() : null;
    if (!record) {
      sample.state = {
        tone: await status.getAttribute('data-tone'),
        sync: await status.getAttribute('data-sync'),
        text: await status.innerText(),
      };
      const next = await messages();
      const requests = next.request.slice(old.request.length);
      sample.requests = requests.map(({ type }) => type);
      sample.replies = next.reply.slice(old.reply.length).map(({ id, ok, code }) =>
        ({ requestType: requests.find((request) => request.id === id)?.type, ok, ...(code ? { code } : {}) }));
      sample.failure = 'no-disk-write';
      if (fault) throw new Error('The test must first confirm a real file write');
      if (sample.state.tone !== 'error') break;
      // Try again from a new user gesture in the next numbered iteration.
      continue;
    }
    const sampleHooks = () => Promise.all([
      cssAccent(page), status.getAttribute('data-sync'),
    ]);
    const expected = accentOf(record);
    const confirmed = await until(async () => {
      const [color, sync] = await sampleHooks();
      if (sync === 'timeout' && sample.timeoutMs === undefined) {
        sample.timeoutMs = duration();
        if (scenario === 'retry') {
          await retry.press('Enter', { timeout: 3000 });
          const resent = await until(async () => {
            const updated = await file();
            return updated?.themeStudio.rev > record.themeStudio.rev ? updated : null;
          }, 4000);
          assert.ok(resent, 'retry signals a new revision of the same theme');
          assert.equal(accentOf(resent), expected);
          assert.equal(resent.themeStudio.borrowedApplied, true);
          sample.retryMs = duration();
        }
      }
      return color.toLowerCase() === expected.toLowerCase() && sync === 'applied';
    }, 35_000);
    sample.appliedMs = confirmed ? duration() : null;
    sample.serverEvents = monitor.count() - noChange;
    const firstSse = monitor.timeAt(noChange);
    if (firstSse !== undefined) sample.firstSseMs = Math.round(firstSse - started);
    sample.browserThemeReads = reads.length - readsBefore;
    if (reads.length > readsBefore) sample.firstBrowserThemeReadMs = Math.round(reads[readsBefore] - started);
    const observed = await messages();
    const writes = observed.request.slice(old.request.length).filter(({ type }) => type === 'file-write');
    sample.fileWriteRequests = writes.length;
    sample.fileWriteSdkReplies = writes.flatMap(({ id }) => observed.reply.slice(old.reply.length)
      .filter((reply) => reply.id === id).map(({ ok, code }) => ({ ok, ...(code ? { code } : {}) })));
    if (!confirmed) {
      const server = await fetch(`${state.url}/api/config/themes`).then((r) => r.json());
      sample.apiHasDiskTheme = server.themes.some((definition) =>
        definition.metadata.id === record.metadata.id && accentOf(definition) === expected);
      sample.failure = !sample.serverEvents ? 'no-server-event-observed'
        : !sample.browserThemeReads ? 'browser-did-not-reload-themes' : 'renderer-or-ready-not-confirmed';
      if (fault) throw new Error(`The native safety path did not settle: ${sample.failure}`);
      // Persist the failed first path; use a fresh dedicated host to repeat
      // instead of overwriting the installed theme out of band.
      break;
    }
    if (fault) {
      assert.ok(sample.timeoutMs >= THEME_CONFIRMATION_TIMEOUT_MS, 'visible timeout before later confirmation');
      assert.ok(sample.appliedMs > sample.timeoutMs, 'later host event alone sets applied');
      if (scenario === 'safety') sample.automaticAfterTimeout = true;
      else sample.appliedAfterExplicitRetry = true;
      break;
    }
    await restore.press('Enter', { timeout: 5000 });
    try { await waitAccent(page, original); sample.restoreConfirmed = true; }
    catch { sample.restoreConfirmed = false; break; }
  }
} catch (error) {
  report.incomplete = error.message;
  if (fault) process.exitCode = 1;
} finally {
  monitor.stop();
  await f.close();
  execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), 'stop', '--name', name], { timeout: 15_000 });
  if (moved) {
    await rm(themes, { recursive: true, force: true });
    await rename(parked, themes);
  }
  await writeFile(join(fixture, 'receipt-result.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
