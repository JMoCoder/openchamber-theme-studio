#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { repo, openFixture, openExtension, readCss, hostVars, debugSummary, spikeTitle } from './dev-browser.mjs';

const [name = 'local', suite = 'theme'] = process.argv.slice(2);
const f = await openFixture(name);
const { page, context, state } = f;
const evidence = join(repo, 'docs', 'research', 'evidence');
await mkdir(evidence, { recursive: true });
const prefix = state.mode === 'desktop' ? 'desktop' : 'web';
const cssVars = [...hostVars, '--padding-scale', '--font-heading', '--oc-radius', '--radius-config', '--radius-md', '--radius-xl'];
async function api(path, method = 'GET', body) {
  const response = await fetch(`${state.url}${path}`, {
    method, signal: AbortSignal.timeout(9_000),
    headers: { Origin: state.url, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; }
  catch { return { status: response.status, body: text.slice(0, 100) }; }
}
async function frame(target = page) {
  const panel = await openExtension(target);
  await panel.locator('#ready').filter({ hasText: 'readyCount' }).waitFor({ timeout: 6000 });
  return panel;
}
async function readResult(panel) {
  const output = panel.locator('#result');
  await output.filter({ hasText: /^\{/u }).waitFor({ timeout: 12_000 });
  return JSON.parse(await output.innerText());
}
async function click(panel, id) {
  await panel.locator(`#${id}`).click({ timeout: 3000 });
  return readResult(panel);
}
function latest(panel) {
  return panel.locator('html').evaluate(() => window.themeSpike.latest);
}
function waitColor(target, color) {
  return target.waitForFunction(
    (color) => getComputedStyle(document.documentElement).getPropertyValue('--primary-base').trim() === color,
    color, { timeout: 8000 },
  );
}
async function screenshot(file) {
  await page.screenshot({ path: join(evidence, `${prefix}-${file}.jpg`), type: 'jpeg', quality: 72 });
}
async function snapshot(target = page) {
  return {
    ...await readCss(target, cssVars),
    ...await target.evaluate(() => ({
      backgroundImage: getComputedStyle(document.body).backgroundImage,
      rootSize: getComputedStyle(document.documentElement).fontSize,
      widthMode: document.documentElement.getAttribute('data-chat-width'),
      themeStorage: Object.fromEntries(Object.keys(localStorage)
        .filter((k) => /^(?:openchamber\.theme\.v2:|selectedThemeId$|selectedThemeVariant$)/.test(k))
        .map((key) => [key.replace(/(?<=v2:).*/, '[runtime]'), localStorage.getItem(key)])),
    })),
  };
}
async function enterAppearance(target = page) {
  if (await target.getByRole('radio', { name: 'System', exact: true }).isVisible()) return;
  await target.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 5000 });
  await target.getByText('Appearance', { exact: true }).first().click({ timeout: 7000 });
  await target.getByRole('radio', { name: 'System', exact: true }).waitFor({ timeout: 7000 });
}
async function settingsClose() {
  const surface = page.getByText('OpenChamber settings window.', { exact: true });
  await page.keyboard.press('Escape');
  if (await surface.isVisible()) {
    await page.getByRole('button', { name: /close settings/i }).first().click({ timeout: 2000 }).catch(() => {});
  }
}
async function measure(panel, count, initial) {
  const rows = [];
  for (let i = 0; i < count; ++i) {
    const color = i % 2 ? '#007b92' : '#aa00ee';
    if (i === 0) assert.notEqual(initial, color);
    await panel.locator('#accent').fill(color);
    const response = await click(panel, 'preview');
    assert.equal(response.error, undefined, JSON.stringify(response));
    await waitColor(page, color);
    const cssMs = await page.evaluate(() => performance.timeOrigin + performance.now());
    await panel.locator('#ready').filter({ hasText: color }).waitFor({ timeout: 5000 });
    const trace = await panel.locator('html').evaluate(() => window.themeSpike.trace.slice(-8));
    const start = trace.findLast((e) => e.type === 'click');
    const ack = trace.findLast((e) => e.type === 'ack');
    const ready = trace.findLast((e) => e.type === 'ready' && e.primary === color);
    rows.push({
      i: i + 1, color, clickToCssMs: Math.round(cssMs - start.ms),
      clickToAckMs: Math.round(ack.ms - start.ms), clickToReadyMs: Math.round(ready.ms - start.ms),
    });
  }
  return rows;
}
async function themeSuite() {
  const result = {};
  const optional = async (key, action) => {
    try { result[key] = await action(); } catch (error) { result[key] = { notCompleted: error.message }; }
  };
  // Prevent Playwright from cropping the screenshot to the iframe itself.
  const initialCss = await snapshot();
  const initial = initialCss.style['--primary-base'];
  let panel = await frame();
  const initialReady = await latest(panel);
  await panel.locator('#variant').selectOption(initialReady.theme.mode);
  result.initial = { root: initialCss, ready: initialReady, sandbox: await page.locator(`iframe[title="${spikeTitle}"]`).getAttribute('sandbox') };
  await screenshot('before');
  result.latency = await measure(panel, prefix === 'web' ? 22 : 3, initial);
  await writeFile(join(evidence, `${prefix}-latency.json`), `${JSON.stringify(result.latency, null, 2)}\n`);
  await screenshot('after');
  console.log(`${prefix} measured ${result.latency.length} click-to-CSS runs`);
  result.changed = { root: await snapshot(), ready: await latest(panel) };
  // Collect a separate-browser client without reading/altering the user's profile.
  if (f.newContext) await optional('otherClients', async () => {
    const other = await f.newContext({ colorScheme: 'light' });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto(state.url, { waitUntil: 'domcontentloaded' });
      await waitColor(otherPage, result.changed.root.style['--primary-base']);
      const secondReady = await latest(await frame(otherPage));
      const mobile = await f.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const m = await mobile.newPage();
        await m.goto(state.url, { waitUntil: 'domcontentloaded' });
        await waitColor(m, result.changed.root.style['--primary-base']);
        const dark = await f.newContext({ colorScheme: 'dark' });
        try {
          const d = await dark.newPage();
          await d.goto(state.url, { waitUntil: 'domcontentloaded' });
          await d.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
          return {
            independentBrowser: secondReady.theme.mode + ' ' + secondReady.theme.tokens.primary,
            mobile: (await snapshot(m)).style['--primary-base'], systemDarkOtherVariant: (await snapshot(d)).style['--primary-base'],
          };
        } finally { await dark.close(); }
      } finally { await mobile.close(); }
    } finally { await other.close(); }
  });
  result.restore = await click(panel, 'restore');
  await waitColor(page, initial);

  await optional('save', async () => {
    const saved = await click(panel, 'save');
    assert.match(saved.file, /^\/lab\/home\/Downloads\/theme-studio-[0-9a-f]+\.json$/u);
    const diskFile = join(state.dir, saved.file.slice('/lab/'.length));
    const json = JSON.parse(await readFile(diskFile, 'utf8'));
    return { file: saved.file, metadata: json.metadata, bytes: (await readFile(diskFile)).length };
  });
  await optional('clipboard', async () => {
    if (prefix === 'web') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const write = await click(panel, 'copy');
    const readback = await page.evaluate(() => navigator.clipboard.readText()).then((text) => ({ chars: text.length, id: JSON.parse(text).metadata.id }))
      .catch((error) => ({ error: error.name }));
    return { write, readback };
  });
  await optional('blobDownload', async () => {
    const downloading = page.waitForEvent('download', { timeout: 1800 }).then(() => true).catch(() => false);
    return { attempted: await click(panel, 'blob'), browserDownload: await downloading };
  });
  for (const action of ['picker', 'eye', 'fonts', 'appearance', 'storage']) await optional(action, () => click(panel, action));
  await optional('dialog', async () => {
    const opened = await click(panel, 'dialog');
    const closed = await click(panel, 'dismiss');
    return { opened, closed };
  });
  await optional('importInFrame', async () => {
    const text = JSON.stringify({ metadata: { id: 'spike-transfer', name: 'Transfer sample' } });
    const input = { name: 'transfer.json', mimeType: 'application/json', buffer: Buffer.from(text) };
    await panel.locator('#import').setInputFiles(input);
    const fromFile = await readResult(panel);
    const drop = panel.locator('#drop');
    await drop.evaluate((el, text) => {
      const data = new DataTransfer();
      data.items.add(new File([text], 'transfer.json', { type: 'application/json' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    }, text);
    const fromDrop = await readResult(panel);
    await panel.locator('#paste').evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, text);
    return { fromFile, fromDrop, fromPaste: await readResult(panel) };
  });
  await optional('sandboxUi', async () => {
    await panel.locator('#drag').click();
    const capture = await readResult(panel);
    await panel.locator('#drag').press('Enter');
    const focus = await readResult(panel);
    const visuals = await panel.locator('#font-sample').evaluate((el) => ({
      family: getComputedStyle(el).fontFamily,
      fontDeclared: document.fonts.check('24px "DejaVu Sans Mono"'),
      measured: (() => {
        const ctx = document.createElement('canvas').getContext('2d');
        const width = (font) => { ctx.font = font; return ctx.measureText('iiiiiiMMMMMM123').width; };
        return [width('24px "DejaVu Sans Mono", serif'), width('24px "DejaVu Sans Mono", sans-serif'), width('24px serif')];
      })(),
      colorInput: document.getElementById('accent').type,
      svg: getComputedStyle(document.querySelector('svg rect')).fill,
      observer: window.themeSpike.sizes,
    }));
    const iframe = page.locator(`iframe[title="${spikeTitle}"]`);
    const firstWidth = (await iframe.boundingBox()).width;
    const resizer = page.getByRole('separator', { name: 'Resize context panel' }).filter({ visible: true }).last();
    let changedWidth = null;
    if (await resizer.isVisible()) {
      const box = await resizer.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(Math.max(2, box.x - 128), box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      changedWidth = (await iframe.boundingBox()).width;
    }
    return { capture, focus, visuals, firstWidth, changedWidth };
  });
  await optional('slot', async () => {
    await panel.locator('#route').selectOption('slot');
    await panel.locator('#variant').selectOption('light');
    await panel.locator('#accent').fill('#cd22a9');
    assert.equal((await click(panel, 'preview')).error, undefined);
    await waitColor(page, initial);
    const filePresent = (await api('/api/config/themes')).body.themes.map((theme) => theme.metadata.id);
    await enterAppearance();
    const row = page.locator('[data-theme-id="theme-studio-spike-light"]');
    await row.waitFor({ timeout: 6000 });
    const beforePick = await row.getAttribute('aria-selected');
    const text = await row.innerText();
    await row.click();
    await waitColor(page, '#cd22a9');
    const afterPick = await row.getAttribute('aria-selected');
    await settingsClose();
    panel = await frame();
    const afterReopen = { ready: await latest(panel), routeControl: await panel.locator('#route').inputValue() };
    await panel.locator('#route').selectOption('slot');
    await panel.locator('#variant').selectOption('light');
    await panel.locator('#accent').fill('#2377c2');
    const updateExisting = await click(panel, 'preview');
    await waitColor(page, '#2377c2');
    await enterAppearance();
    const remove = row.getByRole('button', { name: /delete|remove/i });
    if (await remove.count() === 0) throw new Error('Visible extension slot has no delete control');
    await remove.click();
    const confirmation = page.getByRole('button', { name: /^(delete|remove)$/i }).filter({ visible: true });
    if (await confirmation.count()) await confirmation.last().click({ timeout: 3000 });
    await row.waitFor({ state: 'detached', timeout: 7000 });
    await waitColor(page, initial);
    return { filePresent, text, beforePick, afterPick, afterReopen, updateExisting, afterNativeDelete: await snapshot() };
  });
  await writeFile(join(evidence, `${prefix}-host-checks.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v?.notCompleted || (v?.error ?? (Array.isArray(v) ? `${v.length} rows` : 'recorded'))])));
}

const appearanceKeys = ['uiFont', 'customUiFont', 'monoFont', 'customMonoFont', 'uiFontWeight', 'fontSize',
  'chatFontSize', 'terminalFontSize', 'editorFontSize', 'padding', 'cornerRadius', 'chatWidth', 'layoutAnimations',
  'useSystemTheme', 'themeVariant', 'lightThemeId', 'darkThemeId'];
const pick = (object) => Object.fromEntries(appearanceKeys.filter((key) => Object.hasOwn(object || {}, key)).map((key) => [key, object[key]]));
const settingsPatch = {
  uiFont: 'custom', customUiFont: 'DejaVu Sans Mono', monoFont: 'custom', customMonoFont: 'Liberation Mono',
  uiFontWeight: 'strong', fontSize: 133, chatFontSize: 123, terminalFontSize: 22, editorFontSize: 24,
  padding: 147, cornerRadius: 1, chatWidth: 'wider', layoutAnimations: false,
  useSystemTheme: false, themeVariant: 'dark',
};
async function settingsSuite() {
  const filenames = ['settings.json', 'preferences.json'];
  const result = { runtime: state.mode, nativePage: page.url().replace(/:\d+/, ':[port]') };
  const get = async (surface = prefix) => pick((await api(`/api/config/settings?surface=${surface}`)).body);
  const stream = [];
  const sseStatus = [];
  const record = (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/config/settings') stream.push({ method: request.method(), path: url.pathname, surface: url.searchParams.get('surface') });
    if (url.pathname === '/api/openchamber/events') stream.push({ method: request.method(), path: url.pathname });
  };
  page.on('request', record);
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/api/openchamber/events') sseStatus.push({ status: r.status() });
  });
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).pathname === '/api/openchamber/events') sseStatus.push({ failed: r.failure().errorText });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 15_000 });
  await wait(1600);
  const capture = (file) => readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const files = filenames.map((filename) => join(state.dir, 'openchamber', filename));
  const baseline = await Promise.all(files.map(capture));
  const other = prefix === 'web' ? 'desktop' : 'web';
  try {
    result.before = { css: await snapshot(), onServer: await get(), other: await get(other) };
    const response = await api(`/api/config/settings?surface=${prefix}`, 'PUT', settingsPatch);
    result.put = { status: response.status, returned: pick(response.body) };
    await wait(900);
    result.live = { css: await snapshot(), onServer: await get(), other: await get(other) };
    if (prefix === 'web') {
      const hidden = await context.newPage();
      await hidden.goto('about:blank');
      await hidden.bringToFront();
      const background = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() }));
      await page.bringToFront();
      await wait(450);
      const foreground = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() }));
      await hidden.close();
      result.foreground = { css: await snapshot(), background, foreground, onServer: await get() };
    } else {
      const session = await context.newCDPSession(page);
      const stateOf = () => page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() }));
      try {
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        await wait(350);
        const background = await stateOf();
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        await page.bringToFront();
        await wait(450);
        result.foreground = { css: await snapshot(), background, foreground: await stateOf(), method: 'Browser.setWindowBounds' };
      } catch (error) {
        result.foreground = { css: await snapshot(), unattested: error.message };
      } finally { await session.detach(); }
    }
    const priorStreamRequests = stream.length;
    const priorStatus = sseStatus.length;
    if (state.networkTest) {
      const reconnected = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/openchamber/events' && r.status() === 200,
        { timeout: 10_500 }).then(() => true).catch(() => false);
      execFileSync(process.execPath, [join(repo, 'scripts', 'dev-host.mjs'), 'disconnect', '--name', name]);
      const confirmed = await reconnected;
      await wait(450);
      const css = await snapshot();
      const status = sseStatus.slice(priorStatus);
      result.reconnect = { css, confirmed: confirmed || status.some(({ status }) => status === 200), observed: stream.slice(priorStreamRequests), status };
      result.reconnect.onServer = await get().catch((error) => ({ readFailed: error.message }));
    } else result.reconnect = { notRun: 'requires --network-test' };
    try {
      await enterAppearance();
      const input = page.getByLabel('Font size percentage', { exact: true });
      const valueBefore = await input.inputValue({ timeout: 1500 });
      await input.fill('115');
      await input.press('Tab');
      await wait(1000);
      result.autosaveEdit = { serverAfterSameFieldUiEdit: await get(), ui: await snapshot() };
      result.autosaveEdit.uiValueBefore = valueBefore;
      await api(`/api/config/settings?surface=${prefix}`, 'PUT', settingsPatch);
    } catch (error) {
      result.autosaveEdit = { notRun: error.message };
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('html[data-theme]').waitFor({ state: 'attached', timeout: 10_000 });
    await wait(1100);
    result.reloaded = { css: await snapshot(), onServer: await get(), other: await get(other) };
    result.requests = stream;
  } catch (error) {
    result.error = error.message;
  } finally {
    // Both isolated settings files: undefined values/per-surface stamps also restore.
    if (prefix === 'web') await context.close(); else await page.goto('about:blank').catch(() => {});
    execFileSync(process.execPath, [join(repo, 'scripts', 'dev-host.mjs'), 'stop', '--name', name]);
    const matches = [];
    for (const [i, file] of files.entries()) {
      if (baseline[i]) {
        await writeFile(`${file}.restore`, baseline[i], { mode: 0o600 });
        await rename(`${file}.restore`, file);
      } else await rm(file, { force: true });
      const recovered = await capture(file);
      matches.push({ filename: filenames[i], same: baseline[i] ? recovered?.equals(baseline[i]) : recovered === null });
    }
    result.restoredFiles = matches;
    result.restoredByteIdentical = matches.every((item) => item.same);
    await writeFile(join(evidence, `${prefix}-settings.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ status: result.put?.status, live: result.live?.css, reloaded: result.reloaded?.css,
      reconnect: result.reconnect?.confirmed, restored: result.restoredByteIdentical, error: result.error }, null, 2));
  }
}

async function extraSuite() {
  if (prefix !== 'web') throw new Error('extra runs on the web fixture');
  const result = {};
  const check = async (key, fn) => {
    try { result[key] = await fn(); }
    catch (error) { result[key] = { notCompleted: error.message }; }
  };
  const themes = join(state.dir, 'openchamber', 'themes');
  const hostThemes = async () => (await api('/api/config/themes')).body.themes;
  const fsName = 'theme-studio-probe-light';
  const fsTarget = join(themes, `${fsName}.json`);
  const synthetic = async (panel, params = {}) => {
    const response = await panel.locator('html').evaluate(async (_, params) => (
      window.themeSpike.call('service-request', { method: 'POST', path: '/theme', body: JSON.stringify(params) })
    ), { route: 'slot', variant: 'light', accent: '#fa382b', ...params });
    return JSON.parse(response.body).theme;
  };
  const sdk = (panel, type, payload) => panel.locator('html').evaluate(async (_, { type, payload }) => {
    try { return { ok: true, result: await window.themeSpike.call(type, payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  }, { type, payload });
  const atomicFixture = async (filename, content) => {
    const target = join(themes, filename);
    await writeFile(`${target}.tmp`, content);
    await rename(`${target}.tmp`, target);
  };
  await check('scopedFilesystemAndPrivateApi', async () => {
    const panel = await frame();
    const theme = await synthetic(panel);
    theme.metadata.id = fsName;
    theme.metadata.name = 'Fixture exact grant';
    const path = `/lab/openchamber/themes/${fsName}.json`;
    const content = JSON.stringify(theme);
    const written = await sdk(panel, 'file-write', { path, content });
    assert.equal(written.ok, true, JSON.stringify(written));
    const read = await sdk(panel, 'file-read', { path });
    const scope = await sdk(panel, 'file-write', { path: '/lab/openchamber/themes/not-granted.json', content });
    const settings = await sdk(panel, 'request', { path: '/api/config/settings', method: 'GET' });
    const listing = await sdk(panel, 'file-list', { path: '/lab/openchamber/themes' });
    assert.equal(read.result.content, content);
    assert.equal(scope.ok, false);
    await enterAppearance();
    await page.locator(`[data-theme-id="${fsName}"]`).click();
    await waitColor(page, '#fa382b');
    const exactFileBecameActive = (await snapshot()).style['--primary-base'];
    await page.locator('[data-theme-id="openchamber-light"]').click();
    await settingsClose();
    return { written, readBytes: read.result.content.length, scope, settings, listing, exactFileBecameActive };
  });
  await check('fontAndBackground', async () => {
    const panel = await frame();
    const theme = await synthetic(panel);
    theme.metadata.id = fsName;
    theme.metadata.name = 'Fixture exact grant';
    theme.config = { fonts: { sans: 'DejaVu Sans Mono', mono: 'Liberation Serif', heading: 'DejaVu Serif' } };
    const path = `/lab/openchamber/themes/${fsName}.json`;
    const write = (variant) => sdk(panel, 'file-write', { path, content: JSON.stringify(variant) });
    await write(theme);
    await enterAppearance();
    await page.locator(`[data-theme-id="${fsName}"]`).click();
    await waitColor(page, '#fa382b');
    await wait(2200);
    await settingsClose();
    const normal = { css: await snapshot(), payload: (await hostThemes()).find((item) => item.metadata.id === fsName)?.config?.fonts };
    theme.colors.primary.base = '#133b83';
    theme.config.fonts = Object.fromEntries(Object.entries(theme.config.fonts).map(([k, v]) => [k, `${v} !important`]));
    await write(theme);
    await waitColor(page, '#133b83');
    const important = { css: await snapshot(), payload: (await hostThemes()).find((item) => item.metadata.id === fsName)?.config?.fonts };
    theme.colors.primary.base = '#008038';
    theme.colors.surface.background = 'linear-gradient(45deg, red, blue)';
    theme.config.backgroundImage = 'linear-gradient(45deg, red, blue)';
    await write(theme);
    await wait(2250);
    const gradient = {
      css: await snapshot(),
      listedInServerResponse: (await hostThemes()).find((item) => item.metadata.id === fsName)?.colors.surface.background,
      actual: await page.evaluate(() => [document.documentElement, document.body, document.querySelector('#root')].filter(Boolean).map((el) => ({
        tag: el.tagName, color: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage,
      }))),
    };
    return { normal, important, gradient };
  });
  await rm(fsTarget, { force: true });
  await waitColor(page, '#b35017').catch(() => {});
  await check('existingCustomBackupAndBadFile', async () => {
    const panel = await frame();
    const theme = await synthetic(panel, { route: 'custom', accent: '#915399' });
    const id = theme.metadata.id;
    const filename = `${id}.json`;
    const original = `${JSON.stringify(theme, null, 3)}\n`;
    await atomicFixture(filename, original);
    await enterAppearance();
    const row = page.locator(`[data-theme-id="${id}"]`);
    await row.click();
    await waitColor(page, '#915399');
    const label = await row.innerText();
    await settingsClose();
    await panel.locator('#route').selectOption('custom');
    await panel.locator('#accent').fill('#5026ba');
    const reply = await click(panel, 'preview');
    assert.equal(reply.error, undefined);
    await waitColor(page, '#5026ba');
    await atomicFixture(filename, '{');
    await wait(2250);
    const badKeepsLast = { css: (await snapshot()).style['--primary-base'], server: (await hostThemes()).find((item) => item.metadata.id === id)?.colors.primary.base };
    const dupe = structuredClone(theme);
    dupe.colors.primary.base = '#ff8c51';
    await atomicFixture('zz-unused-duplicate.json', JSON.stringify(dupe));
    await wait(2250);
    const duplicate = (await hostThemes()).filter((item) => item.metadata.id === id).map((item) => item.colors.primary.base);
    await rm(join(themes, 'zz-unused-duplicate.json'), { force: true });
    await atomicFixture(filename, original);
    await waitColor(page, '#915399');
    const restored = (await readFile(join(themes, filename), 'utf8')) === original;
    await enterAppearance();
    await page.locator('[data-theme-id="openchamber-light"]').click();
    await settingsClose();
    await rm(join(themes, filename));
    return { label, wrote: reply.theme.id, badKeepsLast, duplicate, restoredExactly: restored };
  });
  await check('followSystemAndDark', async () => {
    const panel = await frame();
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitColor(page, '#da7c47');
    await panel.locator('#route').selectOption('builtin');
    await panel.locator('#variant').selectOption('dark');
    await panel.locator('#accent').fill('#97fb14');
    assert.equal((await click(panel, 'preview')).error, undefined);
    await waitColor(page, '#97fb14');
    const dark = { ready: await latest(panel), prefs: (await snapshot()).themeStorage };
    await page.emulateMedia({ colorScheme: 'light' });
    await waitColor(page, '#b35017');
    const light = { ready: await latest(panel), prefs: (await snapshot()).themeStorage };
    await click(panel, 'restore');
    return { dark, light };
  });
  await check('nativeVsVsCodeUiImport', async () => {
    const panel = await frame();
    const native = await synthetic(panel);
    const before = (await hostThemes()).map((theme) => theme.metadata.id);
    await enterAppearance();
    const opener = page.getByRole('button', { name: 'Browse themes', exact: true });
    const picker = page.getByRole('button', { name: 'Choose JSON file', exact: true });
    const pick = async (name, text) => {
      if (!await picker.isVisible()) await opener.click();
      const event = page.waitForEvent('filechooser', { timeout: 5000 });
      await picker.click();
      await (await event).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    };
    await pick('native-fixture.json', JSON.stringify(native));
    const rejectedMessage = page.getByText(/This (?:file is not a supported VS Code color theme|theme has no editor\.background color)/);
    await rejectedMessage.first().waitFor({ timeout: 4000 });
    const failure = { message: await rejectedMessage.first().innerText(), numAfter: (await hostThemes()).length };
    const vscode = { name: 'Theme Studio VS Code Fixture', type: 'light', colors: { 'editor.background': '#fff7e0', 'editor.foreground': '#271b30', focusBorder: '#dc3622' }, tokenColors: [] };
    await pick('vscode-fixture.json', JSON.stringify(vscode));
    const detected = await page.waitForFunction((ids) => [...document.querySelectorAll('[data-theme-id]')]
      .map((el) => el.getAttribute('data-theme-id')).find((id) => id?.startsWith('imported-vscode-') && !ids.includes(id)), before, { timeout: 7000 });
    const newId = await detected.jsonValue();
    const imported = (await hostThemes()).find((theme) => theme.metadata.id === newId);
    await api(`/api/config/themes/${encodeURIComponent(newId)}`, 'DELETE');
    return { beforeCount: before.length, failure, success: { idPrefix: newId.split('-').slice(0, 2).join('-'), metadata: imported.metadata,
      background: imported.colors.surface.background } };
  });
  await writeFile(join(evidence, 'web-extra.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(Object.fromEntries(Object.entries(result).map(([key, val]) => [key, val.notCompleted ?? 'recorded'])));
}
async function lifecycleSuite() {
  assert.equal(prefix, 'web', 'lifecycle runs on the web fixture');
  const result = {};
  const id = 'theme-studio-host-spike';
  const themeDisk = join(state.dir, 'openchamber', 'themes', 'theme-studio-spike-light.json');
  const dataDisk = join(state.dir, 'openchamber', 'guest-data', id);
  const node = (...args) => execFileSync(process.execPath, [join(repo, 'scripts', 'dev-host.mjs'), ...args], { encoding: 'utf8' });
  const shellKeys = async (target) => target.evaluate(() => [...document.querySelectorAll('[data-work-status-section]')]
    .map((el) => el.getAttribute('data-work-status-section')));
  assert.equal((await api(`/api/guests/${id}`, 'DELETE')).status, 204);
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Extensions', { exact: true }).first().click();
    await page.getByRole('button', { name: /^Add extension/i }).first().click({ timeout: 5000 });
    const input = page.getByLabel('Folder, ZIP, or URL', { exact: true });
    await input.fill('/lab/extension');
    await input.press('Enter');
    const approval = page.getByRole('dialog').filter({ hasText: 'Run a local service' });
    await approval.waitFor({ timeout: 5500 });
    const grantText = await approval.innerText();
    result.folderUi = {
      dialog: grantText.split('\n').filter((line) => /access|permission|filesystem|separate program|^Runs|\/lab\/openchamber|theme-studio-host-spike/i.test(line)),
    };
    await approval.getByRole('button', { name: 'Allow and enable', exact: true }).click();
    await settingsClose();
  } catch (error) {
    result.folderUi = { notCompleted: error.message };
    await settingsClose();
    node('reload', '--name', name);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  const panel = await frame();
  await panel.locator('#route').selectOption('slot');
  await panel.locator('#accent').fill('#126867');
  assert.equal((await click(panel, 'preview')).error, undefined);
  const dataStarted = (await stat(dataDisk)).isDirectory();
  const stored = await click(panel, 'storage');
  await enterAppearance();
  await page.locator('[data-theme-id="theme-studio-spike-light"]').click();
  await waitColor(page, '#126867');
  await settingsClose();
  await wait(850);
  const cfg = (await api('/api/guests')).body.guests.find((row) => row.id === id);
  result.beforeRestart = { theme: (await snapshot()).style['--primary-base'], dataStarted,
    storageSet: stored.host?.after?.value, granted: cfg.capabilities.granted, statusContribution: cfg.statusSection ?? null,
    observedWorkStatusSectionIds: await shellKeys(page) };
  await f.close();
  node('stop', '--name', name);
  node('start', '--name', name);
  const restarted = await openFixture(name);
  try {
    await waitColor(restarted.page, '#126867');
    const before = await readFile(themeDisk);
    const r = await fetch(`${restarted.state.url}/api/guests/${id}`, {
      method: 'DELETE', headers: { Origin: restarted.state.url }, signal: AbortSignal.timeout(4000),
    });
    const dataRemains = await stat(dataDisk).then(() => true).catch((error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    result.restartAndUninstall = { themeAfterRestart: (await snapshot(restarted.page)).style['--primary-base'],
      uninstallStatus: r.status, guestDataRemains: dataRemains, themeByteIdenticalAfterUninstall: before.equals(await readFile(themeDisk)) };
    await enterAppearance(restarted.page);
    await restarted.page.locator('[data-theme-id="theme-studio-spike-light"]').getByRole('button', { name: /delete|remove/i }).click();
    const confirm = restarted.page.getByRole('button', { name: /^(delete|remove)$/i }).filter({ visible: true });
    if (await confirm.count()) await confirm.last().click();
    await waitColor(restarted.page, '#b35017');
    result.restartAndUninstall.nativeDeleteReturnedDefault = true;
  } finally { await restarted.close(); }
  await writeFile(join(evidence, 'web-lifecycle.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}
try {
  if (suite === 'theme') await themeSuite();
  else if (suite === 'settings') await settingsSuite();
  else if (suite === 'extra') await extraSuite();
  else if (suite === 'lifecycle') await lifecycleSuite();
  else throw new Error('suite 必须为 theme、settings、extra 或 lifecycle。');
} catch (error) {
  console.error(error);
  console.error(await debugSummary(page).catch(() => ({})));
  process.exitCode = 1;
} finally {
  await f.close().catch(() => {});
}
