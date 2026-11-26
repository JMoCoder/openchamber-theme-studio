// Independent RC2 black-box acceptance. Start a fresh v-r2-* --manual-install
// fixture before each run. Only the displayed host settings install/remove it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { openFixture, repo } from './dev-browser.mjs';
import { btn, bytes, config, configDiff, css, files, panelState, sha, until } from './v-verify-rc2-ui.mjs';
import { desktop, fallback, fixed, peer, slow, web } from './v-verify-rc2-cases.mjs';

const [name, test, ...extra] = process.argv.slice(2);
assert.match(name ?? '', /^v-r2-[a-z0-9][a-z0-9-]{0,13}$/u);
const tests = { web, desktop, fallback, fixed, peer, slow: ctx => slow(ctx, 'slow'), preflight: ctx => slow(ctx, 'preflight') };
assert.ok(Object.hasOwn(tests, test) && !extra.length);
const candidate = '40809960e073ee2b1c54ae2426a605cf35ecca64';
const main = 'ac36307b1492ce2c358b39c6fb86aabd14faf1b09d60d7987513d88d124d71b6';
const evidence = join(repo, 'docs/research/evidence');
const output = join(evidence, 'rc2-v');
const directory = join(repo, '.dev-host/instances', name, 'box');
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, candidate);
const manifest = Object.fromEntries(readFileSync(join(evidence, 'package-0.1.0-rc2.sha256'), 'utf8')
  .trim().split('\n').map(line => line.split('  ').reverse()));
assert.equal(Object.keys(manifest).length, 7);
assert.equal(manifest['panel/main.js'], main);
const inspect = root => Object.fromEntries(Object.keys(manifest).map(path => [path, sha(readFileSync(join(root, path)))]));
const rootHashes = inspect(repo);
const stagedHashes = inspect(join(directory, 'extension'));
assert.deepEqual(rootHashes, manifest);
assert.deepEqual(stagedHashes, manifest);
const stagedNames = (dir, base = '') => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (
  entry.isDirectory() ? stagedNames(join(dir, entry.name), base + entry.name + '/') : [base + entry.name]
)).sort();
assert.deepEqual(stagedNames(join(directory, 'extension')), Object.keys(manifest).sort());
const registeredState = JSON.parse(execFileSync(process.execPath, [join(repo, 'scripts/dev-host.mjs'), 'status', '--name', name],
  { encoding: 'utf8' }));
assert.equal(registeredState.dir, directory);
assert.equal(registeredState.running, true);
assert.equal(registeredState.mode, test === 'desktop' ? 'desktop' : 'web');
assert.equal(registeredState.defaultDataDir, test !== 'fallback');
assert.match(registeredState.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
assert.notEqual(new URL(registeredState.url).port, '57123');

mkdirSync(output, { recursive: true, mode: 0o700 });
const actionLog = join(output, `${name}.json`);
const start = Date.now();
const at = () => Date.now() - start;
const version = registeredState.mode === 'desktop' ?
  execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'openchamber'], { encoding: 'utf8' }) :
  JSON.parse(readFileSync(join(repo, '.dev-host/runtime/deps/node_modules/@openchamber/web/package.json'))).version;
const data = { test, name, at: new Date(start).toISOString(), candidate: head, versions: { host: version, node: process.version,
  controllerBrowser: JSON.parse(readFileSync(join(repo, '.dev-host/runtime/deps/node_modules/playwright-core/package.json'))).version },
  files: { root: repo, staged: join(directory, 'extension'), rootHashes, stagedHashes },
  fixture: { pid: registeredState.pid, procStart: registeredState.start, mode: registeredState.mode,
    data: registeredState.openchamberData, defaultDataDir: registeredState.defaultDataDir, url: registeredState.url,
    installation: 'native Settings / Extensions / Add /lab/extension (manual)' },
  observations: [] };
const persist = flag => writeFileSync(actionLog, `${JSON.stringify(data, null, 2)}\n`, { flag, mode: 0o600 });
persist('wx');
function record(stage, values = {}) {
  data.observations.push({ stage, ms: at(), ...values });
  persist('w');
  console.log(`${name}: ${stage}`);
}
const app = await openFixture(name);
const { state, page, context } = app;
assert.equal(state.pid, registeredState.pid);
const dataDir = join(directory, state.defaultDataDir ? 'home/.config/openchamber' : 'openchamber');
assert.equal(state.openchamberData, dataDir);
const dir = join(dataDir, 'themes');
page.setDefaultTimeout(11_000);
const slot = mode => join(dir, `theme-studio-live-${mode}.json`);

// Pure observation of genuine SDK messages. The payloads, permission URLs and
// storage contents are not recorded. The first delivered reply is paired by id.
const tokenNames = ['elevated', 'foreground', 'muted', 'subtle', 'border', 'hover', 'selection', 'focus', 'primary', 'elevatedForeground',
  'active', 'primaryForeground', 'success', 'warning', 'error', 'info', 'syntaxKeyword', 'syntaxString', 'syntaxNumber',
  'syntaxFunction', 'syntaxType', 'syntaxComment', 'syntaxVariable', 'syntaxOperator'];
function observer(names) {
  if (globalThis.__themeStudioRc2Trace) return;
  globalThis.__themeStudioRc2Trace = [];
  globalThis.addEventListener('message', ({ data: m }) => {
    if (m?.channel !== 'openchamber.sdk' || globalThis.__themeStudioRc2Trace.length >= 1000) return;
    const r = { time: Date.now(), type: m.type, id: m.id };
    if (m.type === 'ready') {
      const v = m.payload?.theme;
      Object.assign(r, { mode: v?.mode, tokens: names.map(name => v?.tokens?.[name] ?? null) });
    } else if (typeof m.ok === 'boolean') {
      Object.assign(r, { ok: m.ok, code: m.code, kind: m.payload?.kind });
    } else if (/^(file-|storage-)/u.test(m.type)) {
      const p = m.payload?.path;
      if (p?.endsWith('/themes')) r.target = 'theme-dir';
      else if (typeof p === 'string' && /^theme-studio-[\w-]+\.json$/u.test(p.split('/').at(-1))) r.target = p.split('/').at(-1);
      else if (p?.endsWith('/Downloads') || p?.endsWith('/下载')) r.target = 'downloads';
      else if (p) r.target = 'other';
    } else return;
    globalThis.__themeStudioRc2Trace.push(r);
  });
}
await context.addInitScript(observer, tokenNames);
await page.evaluate(observer, tokenNames);
const index = JSON.parse(readFileSync(join(repo, 'src/data/builtin-index.json')));
const assets = new Map();
const retrieved = [];
page.on('response', response => {
  const path = new URL(response.url()).pathname;
  const panelAsset = path.match(/^\/api\/guest-files\/[^/]+\/(panel\/(?:index\.html|style\.css|main\.js|builtins\.js))$/u)?.[1];
  if (panelAsset && response.ok()) {
    void response.body().then(buf => assets.set(panelAsset, sha(buf))).catch(() => {});
  } else if (path === '/api/config/themes' && response.ok() && response.request().method() === 'GET') {
    void response.json().then(body => {
      const matched = (body.themes ?? []).filter(t => /^(?:openchamber-|theme-studio-)/u.test(t.metadata?.id ?? ''))
        .map(t => ({ id: t.metadata.id, primary: t.colors?.primary?.base }));
      retrieved.push({ ms: at(), themes: matched });
    }).catch(() => {});
  }
});
let cachedGuestEvents = [];
await btn(page, 'Settings').waitFor();
const base = await css(page);
const originalConfig = config(dataDir);
const ctx = { name, state, app, page, base, dir, slot, record, data,
  async screenshot(label) {
    const file = `${name}-${label}.png`;
    const result = await page.screenshot({ type: 'png', timeout: 8000 });
    writeFileSync(join(output, file), result, { flag: 'wx', mode: 0o600 });
    record('screenshot', { file, sha: sha(result), bytes: result.length });
  },
  async sdk() {
    const hostEvents = await page.evaluate(() => globalThis.__themeStudioRc2Trace ?? []).catch(() => []);
    if (ctx.frame) {
      cachedGuestEvents = await ctx.frame.locator('body').evaluate(() => globalThis.__themeStudioRc2Trace ?? [], undefined, { timeout: 800 })
        .catch(() => cachedGuestEvents);
    }
    const requests = hostEvents.filter(m => /^(file-|storage-)/u.test(m.type)).map(m => {
      const reply = cachedGuestEvents.find(r => r.id === m.id && typeof r.ok === 'boolean' && r.time >= m.time);
      return { ms: m.time - start, type: m.type, target: m.target, replyMs: reply ? reply.time - m.time : null,
        ok: reply?.ok, code: reply?.code, kind: reply?.kind };
    });
    const ready = cachedGuestEvents.filter(r => r.type === 'ready').map(r => {
      const key = r.tokens.every(v => typeof v === 'string' && v.length) ? JSON.stringify(r.tokens.map(v => v.toLowerCase())) : null;
      return { ms: r.time - start, mode: r.mode, primary: r.tokens[8], tokenCount: r.tokens.filter(Boolean).length,
        builtinMatches: key === null ? [] : index.flatMap(item => item.variants[r.mode]?.key === key ? [item.variants[r.mode].id] : []) };
    });
    return { ready, requests };
  },
  async directoryLatency(phase) {
    assert.equal(state.mode, 'web');
    const gate = { phase, rows: [] };
    data.nativeDirectoryHttp = gate.rows;
    await page.route(`${state.url}/api/guests/theme-studio/files`, async route => {
      const req = route.request();
      const body = req.postDataJSON();
      if (req.method() !== 'POST' || body?.op !== 'stat' || !body.path?.endsWith('/themes')) return route.fallback();
      const label = gate.phase;
      let artificialMs = 0;
      if (label === 'hold-initial' || (label === 'delay-one-preflight' && !gate.rows.some(r => r.artificialMs > 0))) artificialMs = 8500;
      const event = { phase: label, requestAt: at(), artificialMs };
      gate.rows.push(event);
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 15_000 });
        event.realResponseAt = at();
        event.realStatus = response.status();
        if (artificialMs) await wait(artificialMs);
        await route.fulfill({ response });
        event.deliveredAt = at();
      } catch (error) {
        event.error = String(error.message).split('\n')[0];
        await route.abort().catch(() => {});
      }
    });
    return gate;
  },
};
function nativeFilesSummary() {
  const found = {};
  for (const name of readdirSync(dataDir).filter(file => /guest|extension|theme|preferences|settings/iu.test(file))) {
    const p = join(dataDir, name);
    const entry = readdirSync(dataDir, { withFileTypes: true }).find(item => item.name === name);
    if (entry.isFile()) found[name] = bytes(p);
    else if (entry.isDirectory()) found[name + '/'] = stagedNames(p);
  }
  return found;
}
try {
  assert.equal(version, '2.8.0');
  assert.equal(base.mode, 'light');
  assert.equal(base.brief.primary, '#b35017');
  assert.deepEqual(files(dir), {});
  assert.equal(await page.getByRole('button', { name: 'Theme Studio', exact: true }).count(), 0);
  record('fresh-isolated-host-start-before-native-install', { host: base.brief, themes: files(dir), nativeFiles: nativeFilesSummary(),
    location: page.url(), userAgent: await page.evaluate(() => navigator.userAgent) });
  await tests[test](ctx);
  assert.deepEqual(inspect(repo), manifest);
  assert.deepEqual(inspect(join(directory, 'extension')), manifest);
  if (state.mode === 'web') {
    // builtins.js is lazy. The staged seven-file match is unconditional, but
    // the browser need not download the built-in theme library in these flows.
    await until(() => ['panel/main.js', 'panel/style.css'].every(path => assets.has(path)),
      'served Web JS/CSS asset digests', 3000);
  }
  for (const [asset, digest] of assets) if (asset !== 'panel/index.html') assert.equal(digest, manifest[asset]);
  record('end-fingerprints-and-native-state', { host: (await css(page)).brief, themes: files(dir), nativeConfig: configDiff(originalConfig, config(dataDir)),
    nativeFiles: nativeFilesSummary(), hashesRemainUnchanged: true,
    served: Object.fromEntries(assets), hostWrapsHtml: assets.has('panel/index.html') && assets.get('panel/index.html') !== manifest['panel/index.html'],
    controllerDidNotWriteNativeConfig: true });
  data.outcome = 'verified';
} catch (error) {
  data.outcome = 'needs-review';
  data.error = String(error.stack).replace(/\x1b\[[0-9;]*m/gu, '').slice(0, 5000);
  let visible = null;
  if (ctx.frame) visible = await panelState(ctx.frame).catch(() => null);
  record('stopped-with-evidence-retained', { reason: data.error, visible, host: (await css(page).catch(() => null))?.brief, disk: files(dir),
    nativeFiles: nativeFilesSummary() });
  await ctx.screenshot('needs-review').catch(() => {});
  process.exitCode = 1;
  console.error(data.error);
} finally {
  data.servedAssets = Object.fromEntries(assets);
  data.sdk = await ctx.sdk();
  data.browserOwnThemeCatalogReads = retrieved;
  persist('w');
  await app.close();
}
