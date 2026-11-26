// V standalone acceptance harness. The running application is always a
// dev-host fixture; interactions are browser input, observations are DOM/disk.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openExtension, openFixture, repo } from './dev-browser.mjs';
import { parseTheme, themeToCssVariables } from '../shared/theme-core.mjs';
import { STYLE_RECIPES } from '../shared/style-recipes.mjs';

export const root = realpathSync(repo);
const acceptanceProfile = process.env.V03_ACCEPTANCE_PROFILE ?? 'rc03';
const profiles = Object.freeze(['rc03', 'rc03b', 'rc03c', 'rc03d']);
assert.ok(profiles.includes(acceptanceProfile));
export const priorCandidate = join(root, '.dev-host/packages/i1-rc03');
export const candidate = join(root, `.dev-host/packages/i1-${acceptanceProfile}`);
export const evidence = join(root, 'docs/research/evidence/interactions');
export const legacy = process.env.V03_LEGACY_SOURCE ?? '/tmp/opencode/v03-legacy.Y8a1oSNY/theme-studio';
export const editions = ['light', 'dark'];
export const other = v => v === 'light' ? 'dark' : 'light';
export const cap = v => v[0].toUpperCase() + v.slice(1);
export const button = (target, name) => target.getByRole('button', { name, exact: true });
export const blob = bytes => createHash('sha256').update(bytes).digest('hex');
export const load = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
export function file(path) {
  try {
    const info = statSync(path, { bigint: true });
    return { sha256: blob(readFileSync(path)), mtimeNs: info.mtimeNs.toString(), size: Number(info.size) };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function directory(dir) {
  return Object.fromEntries(readdirSync(dir).sort().filter(n => n.endsWith('.json')).map(n => [n, file(join(dir, n))]));
}
export const shortlist = [
  'constructivist', 'art-deco', 'mineral-landscape', 'retro-desktop',
  'thermal-ramp', 'chalkboard', 'stained-glass', 'kraft-label',
];
export const recipe = id => STYLE_RECIPES.find(r => r.id === id);
export const curated = (id, v) => load(join(root, 'presets', `${id}-${v}.json`));
export const defaults = v => load(join(root, 'src/data/builtin-defaults.json'))[v];
let builtinData;
export const builtin = (id, v) => (builtinData ??= (() => {
  // The bytes are a published data snapshot; never execute the bundle in Node.
  const text = readFileSync(join(candidate, 'panel/builtins.js'), 'utf8');
  return JSON.parse(text.slice(text.indexOf(' = ') + 3).trim().replace(/;$/u, ''));
})())[`${id}-${v}`];
export const styled = (id, base, options = { strength: 1 }) => recipe(id).apply(base, options).definition;
export const cssOf = def => themeToCssVariables(parseTheme(def));
const clean = value => String(value ?? '').trim().toLowerCase().replace(/\s+/gu, '');
const paintKeys = [
  '--surface-background', '--surface-foreground', '--surface-muted', '--surface-muted-foreground',
  '--surface-elevated', '--surface-elevated-foreground', '--surface-subtle',
  '--primary-base', '--primary-hover', '--primary-active', '--primary-foreground',
  '--interactive-border', '--interactive-hover', '--interactive-active', '--interactive-selection',
  '--interactive-focus', '--status-info', '--status-success', '--status-error', '--status-warning',
  '--syntax-background', '--syntax-keyword', '--syntax-string', '--syntax-comment',
  '--chat-user-message-bg', '--chat-divider', '--markdown-link', '--tools-icon',
];
export const painted = (actual, expected) => paintKeys.every(k => clean(actual.values[k]) === clean(expected[k]));
export const paintDiff = (actual, expected, keys = paintKeys) => keys
  .filter(k => clean(actual.values[k]) !== clean(expected[k]))
  .map(k => [k, expected[k] ?? null, actual.values[k] ?? null]);
export const generatedPaintKeys = expected => Object.keys(expected).filter(k => (
  /^--(?:background$|foreground$|surface-|primary-|interactive-|status-|syntax-|markdown-|tools-|chat-|pr-|sidebar-)/u.test(k) &&
  !/var\(/u.test(expected[k])
));
export const expectedPaint = (def, mode = def.metadata.variant) =>
  cssOf({ ...def, metadata: { ...def.metadata, variant: mode } });

export async function eventually(fn, label, deadline = 16_000) {
  const start = performance.now();
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (performance.now() - start > deadline) throw new Error(`未观察到：${label}（${deadline} ms）`);
    await delay(40);
  }
}

export async function rootPaint(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const computed = getComputedStyle(html);
    const text = document.getElementById('opencode-theme-variables')?.textContent ?? '';
    const palette = [...new Set([...text.matchAll(/(--[\w-]+)\s*:/gu)].map(m => m[1]))].sort();
    return {
      at: performance.timeOrigin + performance.now(),
      mode: html.dataset.theme, darkClass: html.classList.contains('dark'),
      media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      scheme: computed.colorScheme,
      values: Object.fromEntries(palette.map(k => [k, computed.getPropertyValue(k).trim()])),
    };
  });
}
export const paintSummary = shot => ({
  mode: shot.mode, media: shot.media, scheme: shot.scheme, darkClass: shot.darkClass,
  count: Object.keys(shot.values).length, hash: blob(JSON.stringify(shot.values)),
  canvas: shot.values['--surface-background'], foreground: shot.values['--surface-foreground'],
  primary: shot.values['--primary-base'], rail: shot.values['--surface-muted'],
});

// Also measure the historical 191-token acceptance surface, independent of
// the count of declarations in the current host's generated stylesheet.
export const historicalSurface = page => page.evaluate(() => {
  const html = document.documentElement, css = getComputedStyle(html);
  const names = [...new Set([
    ...html.style,
    ...[...css].filter(k => /^--(?:primary-|surface-|syntax-|chat-|status-|tools-|sidebar-|markdown-|interactive-|pr-)/u.test(k)),
    '--primary-base', '--background', '--foreground', '--radius', '--font-sans', '--font-mono',
  ])].filter(k => k.startsWith('--') && !/^--(?:oc-|splash-)/u.test(k)).sort();
  return Object.fromEntries(names.map(k => [k, css.getPropertyValue(k).trim()]));
});

export async function settings(page, key) {
  const zh = (await page.locator('html').getAttribute('lang'))?.startsWith('zh');
  const name = { appearance: zh ? '外观' : 'Appearance', extensions: zh ? '扩展' : 'Extensions' }[key];
  const close = button(page, zh ? /关闭设置/u : 'Close settings');
  if (!await close.isVisible()) await button(page, zh ? '设置' : 'Settings').click();
  const head = page.getByRole('heading', { name, exact: true });
  if (!await head.isVisible()) await button(page, name).click();
  await head.waitFor();
}
export async function closeSettings(page) {
  const close = button(page, /^(Close settings|关闭设置)$/u);
  await close.click();
  await close.waitFor({ state: 'hidden' });
}
export async function chooseFixtureProject(page) {
  const picker = button(page, 'Choose project');
  if (!await picker.isVisible()) return;
  await picker.click();
  const item = page.getByRole('option', { name: /^work(?:\s|$)/u });
  if (!await item.isVisible()) {
    await page.getByRole('option', { name: /^Add project/u }).click();
    const dialog = page.getByRole('dialog', { name: 'Add project' });
    await dialog.getByPlaceholder('Enter path or select from tree...').fill('/lab/home/work');
    await button(dialog, 'Add "work"').click();
    await dialog.waitFor({ state: 'hidden' });
    if (!await picker.isVisible()) return;
    await picker.click();
  }
  await item.click();
}
export async function nativeMode(page, mode, media, selectedMode = mode) {
  if (media) await page.emulateMedia({ colorScheme: media });
  await settings(page, 'appearance');
  const zh = (await page.locator('html').getAttribute('lang'))?.startsWith('zh');
  const label = zh ? { light: '浅色', dark: '深色', system: '跟随系统' }[selectedMode] : cap(selectedMode);
  const radio = page.getByRole('radiogroup', { name: zh ? '颜色模式' : 'Color mode' })
    .getByRole('radio', { name: new RegExp(`^${label}${zh ? '' : '\\b'}`, 'u') });
  await radio.click();
  await eventually(async () => (await radio.getAttribute('aria-checked')) === 'true', `native ${selectedMode} radio`);
  await closeSettings(page);
  const result = await eventually(async () => {
    const r = await rootPaint(page);
    return r.mode === mode && r.darkClass === (mode === 'dark') &&
      (!media || r.media === media) && r.values['--surface-background'] && r;
  }, `root ${mode}, prefers-color-scheme ${media ?? 'unchanged'}`);
  return { ...paintSummary(result), selection: selectedMode };
}
export async function language(ctx, target) {
  const { page } = ctx;
  await settings(page, 'appearance');
  const localeMenu = page.getByRole('combobox', { name: /^(Select language|选择语言)$/u });
  await localeMenu.click();
  await page.getByRole('option', { name: target === 'zh' ? /Chinese \(Simplified\)|简体中文/u : /^(English|英语)$/u }).click();
  await eventually(async () => (await page.locator('html').getAttribute('lang')).startsWith(target), `native locale ${target}`);
  await closeSettings(page);
  await mount(ctx);
  await eventually(async () => (await ctx.frame.locator('.studio').getAttribute('data-locale')) === target, `iframe locale ${target}`);
}
export async function nativeTheme(page, mode, id) {
  await settings(page, 'appearance');
  await button(page.getByRole('group', { name: 'Themes', exact: true }), cap(mode)).click();
  const list = page.getByRole('listbox', { name: `${cap(mode)} theme`, exact: true });
  const option = list.locator(`[role="option"][data-theme-id="${id}"]`);
  await option.click();
  await eventually(async () => (await option.getAttribute('aria-selected')) === 'true', `native selected ${id}`);
  const label = (await option.innerText()).trim();
  await closeSettings(page);
  return label;
}
export async function addFromSettings(ctx, version, approve = true) {
  const { page } = ctx;
  await settings(page, 'extensions');
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await button(page, /^Add extension Folder/u).click();
  const source = page.getByRole('textbox', { name: 'Folder, ZIP, or URL' });
  await source.fill('/lab/extension');
  const start = performance.now();
  await button(page, 'Add extension from a folder, ZIP, or URL').click();
  const prompt = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  await prompt.waitFor({ timeout: 36_000 });
  const nativePromptMs = Math.round(performance.now() - start);
  const details = await prompt.ariaSnapshot();
  assert.ok(details.includes(`Theme Studio v${version} wants to`), details);
  assert.ok(details.includes('theme-studio-*.json'), details);
  if (!approve) return prompt;
  await button(prompt, 'Allow and enable').click();
  await prompt.waitFor({ state: 'hidden' });
  await closeSettings(page);
  const registry = await eventually(() => {
    const actual = load(join(ctx.state.openchamberData, 'extensions.json'));
    return actual?.paths?.includes('/lab/extension') && actual?.capabilityGrants?.['theme-studio'] && actual;
  }, 'native registration and grant persisted');
  ctx.record('native-add-and-approval', {
    version, details, source: '/lab/extension', nativePromptMs, grants: registry.capabilityGrants['theme-studio'],
  });
}
export const slotFile = (ctx, mode) => join(ctx.themes, `theme-studio-live-${mode}.json`);
export const act = (ctx, action, id) =>
  ctx.frame.locator(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
export const variant = (ctx, v) => ctx.frame.locator(`[data-act=variant][data-value=${v}]`);
export const snapFiles = ctx => directory(ctx.themes);
export const stateLine = ctx => ctx.frame.locator('.connection').evaluate(el =>
  ({ text: el.innerText, sync: el.dataset.sync ?? null, connection: el.dataset.connection ?? el.dataset.state ?? null }));
export const sample = ctx => ctx.frame.locator('.sample').first().evaluate(el => {
  const style = getComputedStyle(el);
  return Object.fromEntries(['background', 'foreground', 'primary'].map(k => [k, style.getPropertyValue(`--v-${k}`).trim()]));
});
export async function liveToggle(ctx, target) {
  const menu = ctx.frame.locator('details.studio-menu');
  if (!await menu.getAttribute('open').then(x => x !== null)) await menu.locator('summary').click();
  const toggle = menu.locator('[data-change=live]');
  if ((await toggle.isChecked()) !== target) await toggle.click();
  await eventually(async () => (await toggle.isChecked()) === target, `live toggle ${target}`);
  if (await menu.getAttribute('open').then(x => x !== null)) await menu.locator('summary').click();
}
export async function mount(ctx, { waitWrite = true } = {}) {
  ctx.frame = await openExtension(ctx.page, 'Theme Studio');
  await ctx.frame.locator('.studio').waitFor();
  if (waitWrite) await ctx.frame.locator('footer [data-act=save]:enabled').waitFor({ timeout: 12_000 });
  const dismiss = button(ctx.frame, /^(Dismiss getting started|关闭新手引导)$/u);
  if (await dismiss.isVisible()) await dismiss.click();
  // Pure observation: obtain timestamps from trusted browser events, not our
  // Playwright call's dispatch overhead; do not call any app handler.
  await ctx.frame.locator('body').evaluate(body => {
    const win = body.ownerDocument.defaultView;
    if (win.__v03RecordedClicks) return;
    win.__v03RecordedClicks = [];
    body.addEventListener('click', ev => {
      const item = ev.target instanceof win.Element && ev.target.closest('[data-act]');
      if (item && ev.isTrusted) win.__v03RecordedClicks.push({
        at: win.performance.timeOrigin + win.performance.now(),
        act: item.dataset.act, id: item.dataset.id ?? item.dataset.value ?? '',
      });
    }, true);
  });
  const frame = ctx.page.locator('iframe[title="Theme Studio"]');
  ctx.record('native-sidebar', { box: await frame.boundingBox(), sandbox: await frame.getAttribute('sandbox') });
  return ctx.frame;
}
export async function show(ctx, name) {
  const tab = act(ctx, 'tab', name);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}
export async function assetsMatch(ctx, source, after = 0) {
  const result = {};
  for (const n of ['main.js', 'style.css']) {
    const response = await eventually(() => ctx.assets.slice(after).find(a => a.name === n && a.iframe), `iframe’s ${n}`, 6500);
    const expected = readFileSync(join(source, 'panel', n));
    const received = await response.body;
    assert.ok(Buffer.isBuffer(received), `${n}: ${received}`);
    const equal = received.equals(expected);
    result[n] = { equal, status: response.status, size: received.length, sha256: blob(received),
      expected: blob(expected), fromIframe: response.iframe };
    assert.ok(equal, `${n} actual bytes ${blob(received)} != ${blob(expected)}`);
  }
  ctx.record('loaded-actual-iframe-assets', { files: result, sourceVersion: load(join(source, 'package.json')).version });
  return result;
}

export function themeSummary(ctx, native) {
  const p = slotFile(ctx, native), d = load(p);
  return d && { ...file(p), metadata: d.metadata, variant: d.themeStudio?.previewVariant,
    origin: d.themeStudio?.project?.origin, style: d.themeStudio?.project?.style,
    writer: d.themeStudio?.writer, rev: d.themeStudio?.rev,
    primary: d.colors?.primary?.base, canvas: d.colors?.surface?.background };
}
export async function expectPaint(ctx, { label, trigger, def, mode, edit, legacyMode = false, project, timeout = 16_000,
  prior, mustChange = true, broad = false }) {
  const expected = expectedPaint(def, mode);
  const baseline = prior ?? await rootPaint(ctx.page);
  const stamp = file(slotFile(ctx, mode));
  const inactive = file(slotFile(ctx, other(mode)));
  const index = await ctx.frame.locator('body').evaluate(() => window.__v03RecordedClicks.length);
  const beforeClick = Date.now();
  const pressed = await trigger();
  const trusted = await ctx.frame.locator('body').evaluate((_body, n) => window.__v03RecordedClicks.slice(n), index);
  const clickAt = trusted.at(-1)?.at ?? beforeClick;
  let renderAt, latest, latestFile, diff;
  try {
    const done = await eventually(async () => {
      latest = await rootPaint(ctx.page);
      const d = load(slotFile(ctx, mode));
      latestFile = file(slotFile(ctx, mode));
      diff = paintDiff(latest, expected);
      if (latest.mode === mode && diff.length === 0 && renderAt === undefined) renderAt = latest.at;
      if (renderAt === undefined || latest.mode !== mode || diff.length > 0 ||
          !d || d.metadata.variant !== mode || !legacyMode && d.themeStudio?.previewVariant !== edit ||
          project && !project(d.themeStudio?.project) ||
          mustChange && identical(stamp, latestFile) ||
          !painted({ values: cssOf(d) }, expected)) return null;
      return latest;
    }, label, timeout);
    assert.deepEqual(file(slotFile(ctx, other(mode))), inactive, `${label}: inactive slot was written`);
    const comparison = broad ? paintDiff(done, expected, generatedPaintKeys(expected)) : [];
    const data = {
      label, native: mode, edit, trusted, interaction: pressed ?? null,
      before: paintSummary(baseline), after: paintSummary(done),
      latencyMs: identical(baseline.values, done.values) ? null : Math.max(0, Math.round(renderAt - clickAt)),
      expectedChannels: paintKeys.length, expandedChannels: broad ? generatedPaintKeys(expected).length : null,
      expandedDiffs: comparison, file: themeSummary(ctx, mode), status: await stateLine(ctx),
    };
    ctx.record('paint', data);
    if (broad) assert.deepEqual(comparison, [], `${label}: engine vs computed host paint`);
    return { done, data };
  } catch (error) {
    ctx.record('paint-failed', { label, mode, edit, trusted, expected: Object.fromEntries(paintKeys.map(k => [k, expected[k]])),
      diff, actual: latest && paintSummary(latest), file: themeSummary(ctx, mode), status: await stateLine(ctx).catch(() => null) });
    throw error;
  }
}

export async function restore(ctx, baseline, label) {
  await act(ctx, 'restore').click();
  const result = await eventually(async () => {
    const now = await rootPaint(ctx.page);
    return now.mode === baseline.mode && identical(now.values, baseline.values) && now;
  }, `single Restore → ${label}`, 22_000);
  ctx.record('native-palette-restored', { label, state: paintSummary(result), status: await stateLine(ctx), files: snapFiles(ctx) });
  return result;
}
export async function saveAs(ctx, name, which = 'both') {
  await act(ctx, 'save').click();
  const dialog = ctx.frame.locator('dialog[open]');
  const field = dialog.getByRole('textbox');
  await field.click();
  await field.press('Control+a');
  await field.pressSequentially(name);
  const select = dialog.getByRole('combobox');
  const options = await select.locator('option').evaluateAll(items => items.map(item => item.value));
  // Native select via trusted focus and keyboard, not selectOption/JS events.
  await select.focus();
  await ctx.page.keyboard.press('Home');
  for (let i = 0; i < options.indexOf(which); i++) await ctx.page.keyboard.press('ArrowDown');
  assert.equal(await select.inputValue(), which);
  await button(dialog, 'Save to file').click();
  await dialog.locator('.report-file').first().waitFor();
  const output = await dialog.innerText();
  await button(dialog, 'Done').click();
  return output;
}
export function packageFingerprint(source = candidate) {
  const names = ['LICENSE', 'NOTICE.md', 'package.json', ...readdirSync(join(source, 'panel')).sort().map(n => `panel/${n}`)];
  return Object.fromEntries(names.sort().map(n => [n, blob(readFileSync(join(source, n)))]));
}
export function assertPackage(profile = acceptanceProfile) {
  assert.ok(profiles.includes(profile));
  const list = readFileSync(join(root, `.dev-host/lead-03/${profile}.sha256`), 'utf8').trim().split('\n');
  const expected = Object.fromEntries(list.map(s => s.split(/\s+\.\//u).reverse()));
  const actual = packageFingerprint(join(root, `.dev-host/packages/i1-${profile}`));
  assert.deepEqual(actual, expected);
  return actual;
}
export function replaceFixtureExtension(ctx, source = legacy) {
  const folder = join(ctx.state.dir, 'extension');
  assert.equal(realpathSync(folder), folder);
  const before = packageFingerprint(folder);
  assert.ok([legacy, priorCandidate].includes(source));
  assert.notEqual(folder, source);
  assert.notEqual(folder, candidate);
  assert.deepEqual(before, source === priorCandidate ? assertPackage('rc03') : packageFingerprint(source));
  for (const k of Object.keys(assertPackage())) {
    const target = join(folder, k);
    assert.equal(realpathSync(target), target);
    writeFileSync(target, readFileSync(join(candidate, k)));
  }
  assert.deepEqual(packageFingerprint(folder), assertPackage());
  ctx.record('replacement-fixture-only', { from: load(join(source, 'package.json')).version,
    to: load(join(candidate, 'package.json')).version, before, after: assertPackage(),
    method: 'replace staged folder bytes; no registry or API calls' });
}
export function verifyFixtureName(name) {
  const prefix = acceptanceProfile === 'rc03' ? 'v03-' : `v${acceptanceProfile.slice(2)}-`;
  assert.match(name ?? '', new RegExp(`^${prefix}[a-z0-9-]{1,15}$`, 'u'));
}
export async function run(name, runId, script) {
  verifyFixtureName(name);
  assert.match(runId, /^[a-z0-9-]+$/u);
  const packaging = assertPackage();
  const control = join(root, 'scripts/dev-host.mjs');
  const local = JSON.parse(execFileSync(process.execPath, [control, 'status', '--name', name], { encoding: 'utf8' }));
  const d = join(root, '.dev-host/instances', name, 'box');
  assert.equal(local.dir, d);
  assert.equal(local.openchamberData, join(d, 'home/.config/openchamber'));
  assert.ok(local.running && local.defaultDataDir && local.url.startsWith('http://127.0.0.1:'));
  mkdirSync(evidence, { recursive: true });
  const app = await openFixture(name);
  const ctx = { ...app, name, runId, themes: join(d, 'home/.config/openchamber/themes'), assets: [] };
  const report = {
    fixture: name, experiment: runId, host: local.mode, candidateProfile: acceptanceProfile,
    webPackage: load(join(root, '.dev-host/runtime/deps/node_modules/@openchamber/web/package.json')).version,
    started: new Date().toISOString(), candidateBefore: packaging, steps: [], screenshots: [],
  };
  ctx.report = report;
  const out = join(evidence, `${name}-${runId}.json`);
  ctx.record = (stage, data = {}) => {
    report.steps.push({ stage, ...data });
    // A failed or interrupted run still leaves an independently inspectable trail.
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  };
  ctx.shot = async (label, targetPage = ctx.page) => {
    assert.match(label, /^[a-z0-9-]+$/u);
    const name = `${ctx.name}-${runId}-${label}.jpg`;
    const picture = await targetPage.screenshot({ type: 'jpeg', quality: 84, animations: 'disabled', path: join(evidence, name) });
    report.screenshots.push({ name, sha256: blob(picture), entirety: 'complete renderer viewport' });
    return name;
  };
  ctx.page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (!/\/panel\/(?:main\.js|style\.css)$/u.test(pathname)) return;
    let iframe = false;
    try { iframe = !!response.request().frame().parentFrame(); } catch {}
    ctx.assets.push({ name: basename(pathname), iframe, status: response.status(),
      body: response.body().catch(err => err.message) });
  });
  ctx.page.setDefaultTimeout(9_000);
  await ctx.page.setViewportSize({ width: 1360, height: 906 });
  try {
    await script(ctx);
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = (e.stack || String(e)).replace(/\/api\/guest-files\/[^/\s"']+/gu, '/api/guest-files/[fixture-asset-grant]');
    report.lastHost = paintSummary(await rootPaint(ctx.page).catch(() => ({ values: {} })));
    report.lastPanel = await ctx.frame?.locator('.studio-header').ariaSnapshot({ timeout: 1500 }).catch(() => '');
    await ctx.shot('failed').catch(() => {});
    throw e;
  } finally {
    report.candidateAfter = assertPackage();
    report.finished = new Date().toISOString();
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    await app.close();
  }
}
