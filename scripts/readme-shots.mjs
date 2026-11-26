#!/usr/bin/env node
// Linux: node scripts/readme-shots.mjs [--fixture i1-name] [--checksums path]
// Reuses the frozen release and the private Electron/Wayland fixture. Raw
// screenshots and evidence stay in /tmp/opencode; only seven images go to Git.
// Allow at least ten minutes for the 67 real-window captures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { hostname, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { act, addFromSettings, assetsMatch, blob, button, defaults, eventually, expectedPaint,
  generatedPaintKeys, load, nativeMode, nativeTheme, paintDiff, paintSummary, rootPaint, settings,
  show, slotFile, stateLine, variant } from './v-verify-0.3-fixture.mjs';
import { STYLE_RECIPES } from '../shared/style-recipes.mjs';

const root = realpathSync(repo);
const output = join(root, 'docs/images');
const releaseFiles = ['package.json', 'panel/index.html', 'panel/main.js', 'panel/builtins.js',
  'panel/style.css', 'LICENSE', 'NOTICE.md'];
const names = ['hero-en.png', 'hero-zh.png', 'palettes-light.jpg', 'palettes-dark.jpg',
  'styles-light.jpg', 'styles-dark.jpg', 'panel-tabs.png'];
const tabs = [['theme', 'Theme'], ['style', 'Style'], ['tune', 'Color'], ['refine', 'Details'], ['matching', 'Pairings']];
const control = join(root, 'scripts/dev-host.mjs');
const viewportSize = '1600x1000';
const privateScreen = '1600x1032'; // The isolated GNOME top bar takes 32 px outside the Electron window.
const right = '[data-context-zone="right"][data-context-panel-open="true"]';
const project = '/lab/home/work/notes-api';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('node scripts/readme-shots.mjs [--fixture i1-r031w] [--checksums docs/research/evidence/package-0.3.1.sha256] [--compose-from /tmp/opencode/theme-studio-readme-XXXXXX]');
  process.exit(0);
}
const flags = {};
while (args.length) {
  const [flag, value] = args.splice(0, 2);
  assert.ok(['--fixture', '--checksums', '--compose-from'].includes(flag) && value && !value.startsWith('--') && !(flag in flags),
    `未知、重复或缺值的参数：${flag}`);
  flags[flag] = value;
}
const fixtureName = flags['--fixture'] ?? 'i1-r031w';
assert.match(fixtureName, /^i1-[a-z0-9-]{1,36}$/u);
const fixture = join(root, '.dev-host/packages', fixtureName);
const checksumFile = resolve(root, flags['--checksums'] ?? 'docs/research/evidence/package-0.3.1.sha256');
const wanted = Object.fromEntries(readFileSync(checksumFile, 'utf8').trim().split('\n').map(line => {
  const entry = /^([0-9a-f]{64})  (.+)$/u.exec(line);
  assert.ok(entry, `非 SHA-256 清单条目：${line}`);
  return [entry[2], entry[1]];
}));
assert.deepEqual(Object.keys(wanted).sort(), [...releaseFiles].sort());
function verifyPackage(dir) {
  assert.equal(realpathSync(dir), dir);
  for (const path of releaseFiles) {
    assert.equal(realpathSync(join(dir, path)), join(dir, path));
    assert.equal(blob(readFileSync(join(dir, path))), wanted[path], `${dir}: ${path}`);
  }
}
// The release checkout can be preparing a new README or manifest. The only
// install source is the frozen package whose seven checksums are pinned.
verifyPackage(fixture);
const version = load(join(fixture, 'package.json')).version;
const paletteItems = [{ slug: 'default', name: { en: 'Default', zh: '默认' } },
  ...load(join(root, 'presets/index.json')).presets];
const styleItems = [{ id: 'no-style', name: { en: 'No style', zh: '无风格' } }, ...STYLE_RECIPES];
assert.equal(paletteItems.length, 12);
assert.equal(styleItems.length, 18);

function ensureDir(path, options) {
  mkdirSync(path, options);
  assert.ok(lstatSync(path).isDirectory() && realpathSync(path) === path, `拒绝非真实目录：${path}`);
}
function existingImage(path) {
  if (!existsSync(path)) return null;
  assert.ok(lstatSync(path).isFile() && realpathSync(path) === path, `拒绝覆盖此前的非普通文件：${path}`);
  return blob(readFileSync(path));
}
if (existsSync(output)) assert.equal(realpathSync(output), output);
const previous = Object.fromEntries(names.map(name => [name, existingImage(join(output, name))]));
const reuse = flags['--compose-from'];
const work = reuse ? resolve(reuse) : mkdtempSync('/tmp/opencode/theme-studio-readme-');
assert.match(work, /^\/tmp\/opencode\/theme-studio-readme-[A-Za-z0-9]{6}$/u);
assert.equal(realpathSync(work), work);
const runId = randomBytes(4).toString('hex');
const raw = join(work, 'raw'), rendered = join(work, reuse ? `composed-${runId}` : 'composed');
if (reuse) assert.equal(realpathSync(raw), raw); else ensureDir(raw, { mode: 0o700 });
ensureDir(rendered, { mode: 0o700 });
const evidence = join(work, 'manifest.json');
if (reuse) assert.equal(realpathSync(evidence), evidence);
const pkg = { fixture, version, checksumFile, files: wanted };
const report = reuse ? load(evidence) : {
  started: new Date().toISOString(), electron: '', package: pkg,
  viewport: viewportSize, privateScreen, raw, events: [], commands: [], sources: {}, sheets: {}, outputs: [],
};
const save = () => writeFileSync(evidence, `${JSON.stringify(report, null, 2)}\n`);
const record = (type, detail = {}) => { report.events.push({ at: new Date().toISOString(), type, ...detail }); save(); };
const command = (file, argv, options) => {
  report.commands.push([file, ...argv]);
  save();
  return execFileSync(file, argv, { encoding: 'utf8', cwd: root, timeout: 55_000, ...options });
};
const host = (action, name, ...argv) => command(process.execPath, [control, action, '--name', name, ...argv]);
const status = name => JSON.parse(host('status', name));
const owned = new Map();
const marker = () => new Date().toISOString();
console.log(`证据目录：${work}`);

function processStart(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19]; }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; return null; }
}
function reachable(endpoint) {
  return new Promise(resolveTcp => {
    const url = new URL(endpoint);
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    const result = open => { socket.destroy(); resolveTcp(open); };
    socket.once('connect', () => result(true));
    socket.once('error', () => result(false));
    socket.setTimeout(1000, () => result(false));
  });
}
async function stop(name) {
  const own = owned.get(name);
  const current = status(name);
  assert.ok(!current.running || (current.pid === own.pid && current.start === own.start &&
    processStart(current.pid) === own.start), `拒绝停止未核实的 PID：${name}`);
  const message = current.running ? host('stop', name).trim() : '停止前已退出';
  const after = status(name);
  await eventually(() => processStart(own.pid) !== own.start, `PID ${own.pid} 退出`, 5000);
  const [http, cdp] = await Promise.all([reachable(own.url), reachable(own.cdp)]);
  record('stop', { name, pid: own.pid, start: own.start, message, running: after.running, http, cdp });
  assert.ok(!after.running && !http && !cdp, `试件终止未核清：${name}`);
  owned.delete(name);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => {
  void (async () => {
    for (const name of owned.keys()) {
      try { await stop(name); } catch (error) { record('stop-error', { name, error: String(error) }); }
    }
    process.exit(sig === 'SIGINT' ? 130 : 143);
  })();
});

const copy = {
  en: {
    title: 'Cache headers for the Notes API',
    more: ['Review pagination', 'Write release notes', 'Audit response types'],
    ask: 'Make caching explicit for the public release notes endpoint.',
    heading: 'A short cache for release notes',
    text: 'Responses stay fresh for **30 seconds**. On an upstream error, the cache can reuse a stale response for another **120 seconds**.',
    link: 'The [cache guide](https://example.com/cache) now documents both limits.',
  },
  zh: {
    title: '为笔记接口设置缓存',
    more: ['检查分页参数', '整理发布说明', '核对响应类型'],
    ask: '请给公开的发布说明接口明确设置缓存策略。',
    heading: '给发布说明加一层短缓存',
    text: '响应在 **30 秒**内保持新鲜。过期后若上游出错，缓存还可以复用旧响应 **120 秒**。',
    link: '[缓存指南](https://example.com/cache)已记录这两个时限。',
  },
};
const sample = s => [
  `### ${s.heading}`, '', s.text, '',
  '```ts', 'const cache = { maxAge: 30, staleIfError: 120 };', '',
  'export function cacheControl(policy = cache): string {',
  '  const { maxAge, staleIfError } = policy;',
  '  return `public, max-age=${maxAge}, stale-if-error=${staleIfError}`;',
  '}', '```', '',
  '```diff', '- Cache-Control: no-cache', '+ Cache-Control: public, max-age=30, stale-if-error=120', '```', '',
  s.link,
].join('\n');
const ids = ['ses_deeaaa64dffff6KXr61UPaT79X', 'ses_deeaaa64effffz97n49EGwi3gJ',
  'ses_deeaaa64fffffYnxDI2lpR7CA', 'ses_deeaaa650ffffsi2U9wlkExbTm'];
let openCode;
function seed(name, locale) {
  const box = join(root, '.dev-host/instances', name, 'box');
  ensureDir(dirname(dirname(box)), { recursive: true, mode: 0o700 });
  ensureDir(dirname(box), { mode: 0o700 }); // EEXIST is an error: never seed an old fixture.
  const env = {
    HOME: '/lab/home', USER: 'theme-lab', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: '/lab/xdg/config', XDG_DATA_HOME: '/lab/xdg/data', XDG_CACHE_HOME: '/lab/xdg/cache',
    XDG_STATE_HOME: '/lab/xdg/state', XDG_RUNTIME_DIR: '/lab/xdg/run', OPENCODE_CONFIG_DIR: '/lab/xdg/config/opencode',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  };
  for (const path of [project, '/lab/home/.config/openchamber', ...Object.values(env).filter(v => v.startsWith('/lab/'))])
    ensureDir(join(box, path.slice('/lab/'.length)), { recursive: true, mode: 0o700 });
  const projectId = `path_${Buffer.from(project).toString('base64url')}`;
  writeFileSync(join(box, 'home/.config/openchamber/settings.json'), JSON.stringify({
    projects: [{ id: projectId, path: project, label: 'notes-api', addedAt: Date.now() }], activeProjectId: projectId,
  }), { flag: 'wx' });
  const s = copy[locale];
  const stamp = Date.now();
  for (const [i, title] of [...s.more, s.title].entries()) {
    const now = stamp - (ids.length - i) * 1700;
    const sessionID = ids[i], cost = 0, tokens = { input: 39, output: 174, reasoning: 0, cache: { read: 0, write: 0 } };
    const info = { id: sessionID, title, location: { directory: project }, time: { created: now, updated: now + 500 },
      projectID: 'global', cost, tokens };
    const messages = title !== s.title ? [] : [
      { id: 'msg_6f8d59b3b0001uL26LWh3stcc0', type: 'user', time: { created: now + 20 }, text: s.ask },
      { id: 'msg_6f8d59b3ec001P00UaOVzyoD3L', type: 'assistant', time: { created: now + 60, completed: now + 500 },
        model: { providerID: 'opencode', id: 'big-pickle' }, agent: 'build', cost, tokens, finish: 'stop',
        content: [{ type: 'text', text: sample(s) }] },
    ];
    const file = `readme-session-${i}.json`;
    const temp = join(box, file);
    try {
      writeFileSync(temp, JSON.stringify({ info, messages }), { flag: 'wx' });
      command('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--hostname', 'theme-lab', '--clearenv',
        '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
        ...['/usr', '/lib', '/lib64', '/bin'].flatMap(p => ['--ro-bind', p, p]),
        '--bind', box, '/lab', '--ro-bind', openCode, '/opencode',
        ...Object.entries(env).flatMap(([k, v]) => ['--setenv', k, v]), '--chdir', project,
        '/opencode', 'session', 'import', '--standalone', '--directory', project, `/lab/${file}`,
      ], { env: {}, timeout: 18_000 });
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  record('offline-session-import', { name, locale, project, title: s.title, count: ids.length });
  return box;
}

async function frames(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function closeSettings(page) {
  const close = button(page, /^(Close settings|关闭设置)$/u);
  for (let i = 0; i < 3 && await close.isVisible(); i++) {
    await close.press('Enter');
    if (await close.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false)) return;
  }
  await close.waitFor({ state: 'hidden', timeout: 5000 });
}
async function setLanguage(ctx) {
  const { page, locale, frame } = ctx;
  if (!(await page.locator('html').getAttribute('lang')).startsWith(locale)) {
    await settings(page, 'appearance');
    await page.getByRole('combobox', { name: /^(Select language|选择语言)$/u }).click();
    await page.getByRole('option', { name: locale === 'zh' ? /Chinese \(Simplified\)|简体中文/u : /^(English|英语)$/u }).click();
    await eventually(async () => (await page.locator('html').getAttribute('lang')).startsWith(locale), `宿主语言 ${locale}`);
    await closeSettings(page);
  }
  await eventually(async () => (await frame.locator('.studio').getAttribute('data-locale')) === locale, `面板语言 ${locale}`);
}
async function openChat({ page, locale }) {
  const s = copy[locale];
  const row = page.locator('[data-session-row-main]').filter({ hasText: s.title }).first();
  if (!await row.waitFor({ state: 'visible', timeout: 3500 }).then(() => true, () => false)) {
    const projectButton = button(page, 'notes-api').first();
    if (await projectButton.isVisible()) await projectButton.click();
  }
  await row.waitFor({ timeout: 12_000 });
  const box = await row.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width * .42, box.y + box.height / 2);
  await page.getByRole('heading', { name: s.heading, exact: true }).waitFor({ timeout: 12_000 });
  await page.locator('[data-streamdown="code-block"]').nth(1).waitFor({ timeout: 9000 });
}
async function resize(ctx) {
  const { page, iframe } = ctx;
  const grip = page.locator(`${right} > [role=separator]`);
  await grip.waitFor();
  for (let i = 0; i < 4; i++) {
    const measured = (await iframe.boundingBox()).width;
    if (Math.abs(measured - 420) <= 1) return;
    const g = await grip.boundingBox();
    assert.ok(g);
    const x = g.x + g.width / 2, y = g.y + Math.min(64, g.height / 2);
    assert.ok(await grip.evaluate((el, point) => el.contains(document.elementFromPoint(...point)), [x, y]));
    await page.mouse.move(x, y);
    await page.mouse.down();
    try { await frames(page); await page.mouse.move(x + measured - 420, y, { steps: 14 }); }
    finally { await page.mouse.up(); }
    await eventually(async () => Math.abs((await iframe.boundingBox()).width - 420) <= 1, '420 px 原生右栏', 1400)
      .catch(() => {}); // A native maximum or rail transition may require another drag.
  }
  assert.ok(Math.abs((await iframe.boundingBox()).width - 420) <= 1, '右栏实际宽度不是 420 px');
}
const privateTextChecks = [process.env.HOME, userInfo().username, hostname()].filter(v => v?.length > 2);
const modeMatches = (paint, mode) => paint.mode === mode && paint.darkClass === (mode === 'dark') && paint.scheme === mode;
const definition = (item, mode) => item.slug === 'default' ? defaults(mode)
  : load(join(root, 'presets', item.variants[mode].file));
function comparison(paint, expected) {
  return paintDiff(paint, expected, generatedPaintKeys(expected));
}
async function enterMode(ctx, mode) {
  const { page } = ctx;
  await nativeMode(page, mode);
  const wanted = expectedPaint(defaults(mode));
  if (comparison(await rootPaint(page), wanted).length) await nativeTheme(page, mode, `openchamber-${mode}`);
  const baseline = await eventually(async () => {
    const paint = await rootPaint(page);
    return modeMatches(paint, mode) && comparison(paint, wanted).length === 0 && paint;
  }, `宿主原生 ${mode} 模式及默认配色`);
  ctx.mode = mode;
  record('native-appearance', { name: ctx.name, ...paintSummary(baseline) });
}
const statusPattern = /^(?:Window preview|整窗预览) · /u;
async function confirm(ctx, label, def, palette, recipe, trigger, selected) {
  const mode = ctx.mode, other = mode === 'light' ? 'dark' : 'light';
  const expected = expectedPaint(def), keys = generatedPaintKeys(expected), slot = slotFile(ctx, mode);
  const before = existingImage(slot), inactive = existingImage(slotFile(ctx, other));
  await trigger.click({ timeout: 7000 });
  let last;
  const verified = await eventually(async () => {
    const doc = load(slot), hash = existingImage(slot), state = await stateLine(ctx);
    const paint = await rootPaint(ctx.page);
    const model = doc?.themeStudio?.project, layer = model?.style[mode], origin = model?.origin;
    const options = Object.fromEntries((recipe?.options ?? []).map(o => [o.key, layer?.options?.[o.key] ?? o.default]));
    const diffs = paintDiff(paint, expected, keys);
    last = { diffs, origin, layer, state, native: paintSummary(paint), previewVariant: doc?.themeStudio?.previewVariant };
    return modeMatches(paint, mode) && !diffs.length && statusPattern.test(state.text) &&
      doc?.metadata.variant === mode && doc?.themeStudio?.previewVariant === mode && hash !== before &&
      origin?.kind === (palette.slug === 'default' ? 'default' : 'preset') &&
      (palette.slug === 'default' || origin.ref === palette.slug) && (layer?.id ?? null) === (recipe?.id ?? null) &&
      (!recipe || layer?.strength === recipe.strength.default && recipe.options.every(o => options[o.key] === o.default)) &&
      (await selected.getAttribute('aria-pressed')) === 'true' &&
      { native: paintSummary(paint), expectedChannels: keys.length, slotSha256: hash, origin,
        recipe: recipe ? { id: layer.id, strength: layer.strength, options } : null, state };
  }, `${label}：宿主颜色、面板回执与磁盘作品`, 23_000).catch(error => {
    record('failed-paint', { name: ctx.name, label, ...last });
    throw error;
  });
  assert.equal(existingImage(slotFile(ctx, other)), inactive, '另一宿主明暗的槽位不能被修改');
  return verified;
}
async function palette(ctx, item) {
  await show(ctx, 'theme');
  const v = variant(ctx, ctx.mode);
  if (await v.getAttribute('aria-pressed') !== 'true') await v.click();
  const card = item.slug === 'default' ? act(ctx, 'load-default', 'openchamber') : act(ctx, 'load-preset', item.slug);
  return confirm(ctx, `palette/${ctx.mode}/${item.slug}`, definition(item, ctx.mode), item, null, card, card);
}
async function style(ctx, item, base = paletteItems[0]) {
  await show(ctx, 'style');
  const recipe = item.id === 'no-style' ? null : item;
  const baseDef = definition(base, ctx.mode);
  const def = recipe ? recipe.apply(baseDef, { strength: recipe.strength.default }).definition : baseDef;
  const card = act(ctx, 'style', recipe?.id ?? '');
  return confirm(ctx, `style/${ctx.mode}/${item.id}`, def, base, recipe, card, card);
}
async function topOfPanel(ctx) {
  const main = ctx.frame.locator('.studio-main');
  const top = () => main.evaluate(el => el.scrollTop);
  if (await top() <= 1) return;
  const box = await main.boundingBox();
  await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ctx.page.mouse.wheel(0, -2000);
  await eventually(async () => await top() <= 1, '原生滚动回到面板顶部', 4000);
}
async function shot(ctx, key, paint, crop = false) {
  const { page, frame, iframe, locale } = ctx;
  await topOfPanel(ctx);
  await page.mouse.move(1, 500);
  await frame.locator('body').evaluate(body => body.ownerDocument.fonts.ready.then(() => undefined));
  await frames(page);
  assert.deepEqual(paintSummary(await rootPaint(page)), paint.native, `${key} 抓图前宿主配色发生变化`);
  assert.match((await stateLine(ctx)).text, statusPattern);
  const viewport = await page.evaluate(() => ({
    inner: `${innerWidth}x${innerHeight}`, outer: `${outerWidth}x${outerHeight}`,
    screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, locale: document.documentElement.lang,
  }));
  assert.deepEqual([viewport.inner, viewport.outer, viewport.screen, viewport.dpr], [viewportSize, viewportSize, privateScreen, 1]);
  assert.ok(viewport.locale.startsWith(locale));
  const iframeLocale = await frame.locator('.studio').getAttribute('data-locale');
  assert.equal(iframeLocale, locale);
  const panel = await iframe.boundingBox();
  assert.ok(panel && Math.abs(panel.width - 420) <= 1 && panel.x + panel.width <= 1600 && panel.y + panel.height <= 1000);
  const screenText = `${await page.locator('body').innerText()}\n${await frame.locator('body').innerText()}`.toLowerCase();
  for (const privateText of privateTextChecks) assert.ok(!screenText.includes(privateText.toLowerCase()), '界面文本包含本机个人信息');
  const code = await page.locator('[data-streamdown="code-block"]').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return { y: r.y, bottom: r.bottom, color: getComputedStyle(node).backgroundColor };
  }));
  assert.ok(code.length >= 2 && code.slice(0, 2).every(box => box.y >= 0 && box.bottom <= 950), `${key} 聊天代码未完整入镜`);
  const path = join(raw, `${key}.png`);
  const bytes = await page.screenshot({ path, scale: 'css', animations: 'allow', caret: 'initial', timeout: 12_000 });
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1600, 1000]);
  report.sources[key] = { path, bytes: bytes.length, sha256: blob(bytes), instance: ctx.name, viewport, panel, code, paint,
    ...(crop ? { crop: { x: Math.ceil(panel.x), y: Math.ceil(panel.y), w: Math.floor(panel.width), h: Math.floor(panel.height) } } : {}) };
  save();
  return key;
}
function sheet(file, list, prefix, mode, id) {
  report.sheets[file] = list.map((item, i) => {
    const key = `${prefix}-${mode}-${item[id]}`, src = report.sources[key];
    assert.ok(src);
    return { position: i + 1, label: `${item.name.en} · ${item.name.zh}`, key, path: src.path, sha256: src.sha256 };
  });
  save();
}
async function galleries(ctx, tidemark, initial) {
  const mode = ctx.mode;
  // Start from a real, visibly different paint before selecting Default.
  await shot(ctx, `palette-${mode}-${tidemark.slug}`, initial);
  for (const item of paletteItems.filter(p => p !== tidemark))
    await shot(ctx, `palette-${mode}-${item.slug}`, await palette(ctx, item));
  sheet(`palettes-${mode}.jpg`, paletteItems, 'palette', mode, 'slug');
  await palette(ctx, paletteItems[0]);
  await style(ctx, STYLE_RECIPES[0]); // Then No style must repaint back to Default, not just have the same colors.
  for (const item of styleItems) await shot(ctx, `style-${mode}-${item.id}`, await style(ctx, item));
  sheet(`styles-${mode}.jpg`, styleItems, 'style', mode, 'id');
}
async function fixtureRun(locale) {
  const name = `rdm-${runId}-${locale}`, box = seed(name, locale);
  const requested = marker();
  const state = JSON.parse(host('start', name, '--desktop', '--screen', privateScreen, '--default-data-dir',
    '--manual-install', '--extension', fixture, '--opencode', openCode));
  owned.set(name, state);
  record('start', { name, locale, requested, ...state });
  let ctx;
  try {
    assert.ok(state.mode === 'desktop' && state.defaultDataDir && !state.networkTest && state.extension === null);
    assert.equal(state.dir, box);
    assert.equal(state.openchamberData, join(box, 'home/.config/openchamber'));
    for (const endpoint of [state.url, state.cdp]) assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(processStart(state.pid), state.start);
    verifyPackage(join(box, 'extension'));
    ctx = { ...await openFixture(name), name, locale, mode: 'light', assets: [],
      themes: join(state.openchamberData, 'themes'), record: (type, data) => record(type, { name, ...data }) };
    const { page } = ctx;
    page.setDefaultTimeout(8000);
    const prompt = await addFromSettings(ctx, version, false);
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (!/\/panel\/(?:main\.js|style\.css)$/u.test(path)) return;
      if (response.request().frame().parentFrame())
        ctx.assets.push({ name: basename(path), iframe: true, status: response.status(), body: response.body() });
    });
    await button(prompt, 'Allow and enable').click();
    await prompt.waitFor({ state: 'hidden' });
    await closeSettings(page);
    await eventually(() => {
      const value = load(join(state.openchamberData, 'extensions.json'));
      return value?.paths?.includes('/lab/extension') && value.capabilityGrants?.['theme-studio'];
    }, '原生设置审批落盘');
    await enterMode(ctx, 'light');
    await openChat(ctx);
    ctx.frame = await openExtension(page, 'Theme Studio');
    ctx.iframe = page.locator('iframe[title="Theme Studio"]');
    await ctx.frame.locator('footer [data-act=save]:enabled').waitFor({ timeout: 12_000 });
    await assetsMatch(ctx, fixture);
    const dismiss = button(ctx.frame, 'Dismiss getting started');
    if (await dismiss.isVisible()) await dismiss.click();
    await setLanguage(ctx);
    await resize(ctx);
    const tidemark = paletteItems.find(p => p.slug === 'tidemark');
    assert.ok(tidemark);
    const light = await palette(ctx, tidemark);
    await shot(ctx, `hero-${locale}`, light);
    console.log(`${locale} hero 完成：${name} PID ${state.pid}`);
    if (locale === 'en') {
      await galleries(ctx, tidemark, light);
      const dawn = await palette(ctx, tidemark);
      assert.ok(dawn.native.mode === 'light');
      const tabPaint = await style(ctx, STYLE_RECIPES.find(r => r.id === 'soft-glass'), tidemark);
      report.sheets['panel-tabs.png'] = [];
      for (const [id, label] of tabs) {
        await show(ctx, id);
        const tab = act(ctx, 'tab', id);
        assert.equal((await tab.innerText()).trim(), label);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        const key = await shot(ctx, `tab-${id}`, tabPaint, true);
        const { path, sha256, crop } = report.sources[key];
        report.sheets['panel-tabs.png'].push({ position: report.sheets['panel-tabs.png'].length + 1, label, key, path, sha256, crop });
      }
      await enterMode(ctx, 'dark');
      await ctx.iframe.waitFor({ state: 'visible' });
      await galleries(ctx, tidemark, await palette(ctx, tidemark));
    }
  } finally {
    try { await ctx?.close(); } finally { await stop(name); }
  }
}

function magick(argv) { return command('magick', argv); }
function stats(file) {
  const bytes = readFileSync(file);
  const [width, height] = magick(['identify', '-ping', '-format', '%w %h', file]).trim().split(' ').map(Number);
  return { width, height, bytes: bytes.length, sha256: blob(bytes) };
}
async function validateCaptures() {
  assert.equal(report.electron, '2.8.0');
  assert.deepEqual(report.package, pkg);
  assert.equal(report.raw, raw);
  const expected = new Map([['hero-en', ['en', 'light']], ['hero-zh', ['zh', 'light']]]);
  for (const mode of ['light', 'dark']) {
    for (const [file, items, prefix, id] of [
      [`palettes-${mode}.jpg`, paletteItems, 'palette', 'slug'],
      [`styles-${mode}.jpg`, styleItems, 'style', 'id'],
    ]) {
      assert.equal(report.sheets[file]?.length, items.length, `${file} 的原图不齐`);
      for (const [i, item] of items.entries()) {
        const row = report.sheets[file][i], key = `${prefix}-${mode}-${item[id]}`;
        assert.deepEqual([row.position, row.label, row.key], [i + 1, `${item.name.en} · ${item.name.zh}`, key]);
        expected.set(key, ['en', mode]);
      }
    }
  }
  assert.equal(report.sheets['panel-tabs.png']?.length, tabs.length);
  for (const [i, [id, label]] of tabs.entries()) {
    const row = report.sheets['panel-tabs.png'][i], key = `tab-${id}`;
    assert.deepEqual([row.position, row.label, row.key, row.crop], [i + 1, label, key, report.sources[key]?.crop]);
    expected.set(key, ['en', 'light']);
  }
  const starts = report.events.filter(e => e.type === 'start'), stops = report.events.filter(e => e.type === 'stop');
  assert.deepEqual(starts.map(e => e.locale).sort(), ['en', 'zh']);
  assert.equal(stops.length, 2);
  for (const start of starts) {
    const end = stops.find(e => e.name === start.name && e.pid === start.pid && e.start === start.start);
    assert.ok(end && !end.running && !end.http && !end.cdp);
    assert.match(start.name, /^rdm-[a-f0-9]{8}-(en|zh)$/u);
    assert.equal((await status(start.name)).running, false, `试件尚未结束：${start.name}`);
  }
  assert.deepEqual(Object.keys(report.sources).sort(), Array.from(expected.keys()).sort());
  for (const [key, [locale, mode]] of expected) {
    const src = report.sources[key], path = join(raw, `${key}.png`);
    assert.equal(src.path, path);
    assert.equal(realpathSync(path), path);
    const contents = readFileSync(path);
    assert.equal(src.sha256, blob(contents));
    assert.equal(src.bytes, contents.length);
    assert.deepEqual([contents.readUInt32BE(16), contents.readUInt32BE(20)], [1600, 1000]);
    assert.equal(src.instance, starts.find(e => e.locale === locale)?.name);
    assert.ok(src.viewport.locale.startsWith(locale) && Math.abs(src.panel.width - 420) <= 1);
    assert.ok(modeMatches(src.paint.native, mode) && src.paint.state.sync === 'applied' && statusPattern.test(src.paint.state.text));
  }
  for (const rows of Object.values(report.sheets)) {
    for (const row of rows) {
      const src = report.sources[row.key];
      assert.deepEqual([row.path, row.sha256], [src.path, src.sha256]);
    }
  }
}
function compose() {
  const font = command('fc-match', ['-f', '%{file}', 'Noto Sans CJK SC']).trim();
  assert.ok(existsSync(font));
  for (const name of names) {
    const file = join(rendered, name);
    if (name.startsWith('hero')) {
      const src = report.sources[name.slice(0, -4)];
      writeFileSync(file, readFileSync(src.path), { flag: 'wx' });
    } else if (name === 'panel-tabs.png') {
      const cuts = report.sheets[name].map(({ key, path, crop: { x, y, w, h } }) => {
        const cut = join(rendered, `${key}-crop.png`);
        magick([path, '-crop', `${w}x${h}+${x}+${y}`, '+repage', '-strip', cut]);
        return cut;
      });
      for (const width of [308, 284, 260]) {
        magick(['montage', ...cuts, '-tile', '5x1', '-geometry', `${width}x+4+0`, '-background', '#dedfe1',
          '-strip', '-depth', '8', '-define', 'png:compression-level=9', file]);
        if (readFileSync(file).length <= 700_000) break;
      }
    } else {
      const isPalette = name.startsWith('palettes'), mode = name.endsWith('-light.jpg') ? 'light' : 'dark';
      const [cols, width, height] = isPalette ? [4, 384, 240] : [3, 514, 321];
      const text = mode === 'light' ? '#242933' : '#f3f4f5';
      const background = mode === 'light' ? '#edf0f3' : '#242a31';
      for (const quality of [90, 86, 82, 78, 74]) {
        magick(['montage', '-font', font, '-pointsize', '17', '-fill', text,
          ...report.sheets[name].flatMap(({ label, path }) => ['-label', label, path]),
          '-background', background, '-tile', `${cols}x`, '-geometry', `${width}x${height}+6+5`, '-strip',
          '-sampling-factor', '4:4:4', '-quality', String(quality), file]);
        if (readFileSync(file).length <= 650_000) break;
      }
    }
    const info = stats(file);
    assert.ok(info.bytes <= 700_000 && info.width <= 1600, `${name} 超出宽度或体积限制`);
    report.outputs.push({ path: join(output, name), ...info });
  }
  report.totalBytes = report.outputs.reduce((sum, info) => sum + info.bytes, 0);
  assert.ok(report.totalBytes <= 4_000_000);
  assert.equal(Object.keys(report.sources).length, 67);
  save();
}
function publish() {
  ensureDir(output, { recursive: true });
  for (const name of names) assert.equal(existingImage(join(output, name)), previous[name], `${name} 被并行修改，拒绝覆盖`);
  for (const name of names) {
    const path = join(output, name), temp = join(output, `.${runId}-${name}.tmp`);
    try {
      writeFileSync(temp, readFileSync(join(rendered, name)), { flag: 'wx' });
      renameSync(temp, path);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
    assert.equal(existingImage(path), report.outputs.find(f => f.path === path).sha256);
  }
}
function writeIndex() {
  const ticks = value => `\`${value}\``;
  const reportText = [
    '# README 实拍证据', '', `- OpenChamber 桌面版 ${report.electron} ／ Theme Studio ${version}；私有屏幕 ${privateScreen}，外窗与视口均为 ${viewportSize}。`,
    `- 成品合计 ${report.totalBytes} 字节。格子均按从左到右、从上到下排列。`,
    '- 成品 Hero 直接复制全窗原始 PNG；联系表仅缩放、拼接、加双语标注并编码 JPEG；标签条仅裁切、缩放、拼接 PNG。',
    '- 聊天是导入隔离 OpenCode 的合成演示数据，未调用模型；面板和聊天均由真实 Electron 渲染。', '',
    '## 成品', '', '| 路径 | 像素 | 字节 | SHA-256 |', '|---|---:|---:|---|',
    ...report.outputs.map(f => `| ${ticks(f.path)} | ${f.width}×${f.height} | ${f.bytes} | ${ticks(f.sha256)} |`), '',
    ...Object.entries(report.sheets).flatMap(([name, entries]) => [
      `## ${name}`, '', '| 格 | 名称 | 实拍原图 | SHA-256 |', '|---:|---|---|---|',
      ...entries.map(e => `| ${e.position} | ${e.label} | ${ticks(e.path)} | ${ticks(e.sha256)} |`), '',
    ]),
    '## 隔离试件的启动与停止记录', '', ...report.events.filter(e => ['start', 'stop'].includes(e.type)).map(e =>
      `- ${e.at} ${e.type} ${e.name}，PID ${e.pid}（${e.start}）：${e.message ?? `${e.url} / CDP ${e.cdp} / ${e.openchamberData}`}${e.type === 'stop' ? `；running=${e.running}, http=${e.http}, cdp=${e.cdp}` : ''}`),
    '', `逐张宿主取色回执、原图边界和本次实际执行的完整命令 argv：${ticks(evidence)}。`, '',
  ].join('\n');
  writeFileSync(join(work, 'manifest.md'), reportText);
}

try {
  if (!reuse) {
    openCode = realpathSync(command('/usr/bin/which', ['opencode']).trim());
    report.electron = command('dpkg-query', ['-W', '-f=${Version}', 'openchamber']).trim();
    assert.equal(report.electron, '2.8.0');
    await fixtureRun('zh');
    await fixtureRun('en');
  }
  await validateCaptures();
  if (reuse) record('compose-resume', { argv: process.argv, originalCaptures: Object.keys(report.sources).length });
  report.outputs = [];
  compose();
  publish();
  record('finished', { totalBytes: report.totalBytes });
  writeIndex();
  console.log(`完成：${join(work, 'manifest.md')}（${report.totalBytes} 字节；已停止两个自有试件）`);
} catch (error) {
  record('error', { message: error.stack ?? String(error) });
  console.error(error);
  process.exitCode = 1;
}
