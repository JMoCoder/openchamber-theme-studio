#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = join(repo, '.dev-host');
const control = join(repo, 'scripts', 'dev-host.mjs');
const require = createRequire(join(fixture, 'runtime', 'deps', 'package.json'));

function browserExecutable(headed) {
  if (process.env.DEV_HOST_CHROMIUM) return resolve(process.env.DEV_HOST_CHROMIUM);
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const kind = headed ? /^chromium-\d+$/ : /^chromium_headless_shell-\d+$/;
  for (const dir of readdirSync(cache).filter((name) => kind.test(name)).sort((a, b) => (
    Number(b.split('-').at(-1)) - Number(a.split('-').at(-1))
  ))) {
    for (const folder of ['chrome-headless-shell-linux64', 'chrome-linux64', 'chrome-linux']) {
      const path = join(cache, dir, folder, headed ? 'chrome' : 'chrome-headless-shell');
      if (existsSync(path)) return path;
    }
  }
  throw new Error('请将 DEV_HOST_CHROMIUM 指向适合本试验模式的 Playwright Chromium。');
}

export async function openFixture(name, options = {}) {
  const state = JSON.parse(execFileSync(process.execPath, [control, 'status', '--name', name], { encoding: 'utf8' }));
  if (!state.running || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(state.url)) throw new Error(`隔离实例 ${name} 未启动。`);
  const { chromium } = require('playwright-core');
  if (state.mode === 'desktop' && !options.forceWeb) {
    const discovery = await fetch(`${state.cdp}/json/version`).then((response) => response.json());
    const endpoint = new URL(discovery.webSocketDebuggerUrl);
    endpoint.host = new URL(state.cdp).host;
    const browser = await chromium.connectOverCDP(String(endpoint));
    const context = browser.contexts()[0];
    let page = context.pages().find((p) => /^(?:openchamber:|http:\/\/127\.0\.0\.1:27123)/.test(p.url())) || context.pages()[0];
    if (!page) page = await context.waitForEvent('page', { timeout: 10_000 });
    await page.locator('html[data-theme]').waitFor({ state: 'attached', timeout: 15_000 });
    return { state, browser, context, page, close: () => browser.close() };
  }
  function folder(path) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return path;
  }
  const home = folder(join(state.dir, 'browser-home'));
  const wayland = process.env.DEV_HOST_WAYLAND_DIR ? realpathSync(resolve(process.env.DEV_HOST_WAYLAND_DIR)) : null;
  if (wayland && (!wayland.startsWith(`${realpathSync(fixture)}/instances/`) || !statSync(join(wayland, 'oc-fixture')).isSocket())) {
    throw new Error('只接入 .dev-host 内的私有 oc-fixture Wayland 套接字。');
  }
  // Chromium singleton Unix sockets have a 108-byte path limit.
  const tmp = mkdtempSync('/tmp/opencode/ocb-');
  const oldTmp = process.env.TMPDIR;
  let browser;
  try {
    process.env.TMPDIR = tmp;
    if (wayland) symlinkSync(wayland, join(tmp, 'wayland'));
    browser = await chromium.launch({
      executablePath: browserExecutable(Boolean(wayland)),
      headless: !wayland,
      env: {
        HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
        TMPDIR: tmp, XDG_CONFIG_HOME: folder(join(home, 'config')),
        XDG_CACHE_HOME: folder(join(home, 'cache')), XDG_DATA_HOME: folder(join(home, 'data')),
        XDG_STATE_HOME: folder(join(home, 'state')), XDG_RUNTIME_DIR: folder(wayland ? tmp : join(tmp, 'run')),
        ...(wayland ? { WAYLAND_DISPLAY: join(tmp, 'wayland', 'oc-fixture'), GDK_BACKEND: 'wayland' } : {}),
      },
      args: ['--disable-background-networking', '--no-default-browser-check', '--no-first-run',
        ...(wayland ? ['--ozone-platform=wayland', '--disable-gpu'] : [])],
    });
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  }
  const close = async () => {
    try { await browser.close(); } finally { rmSync(tmp, { recursive: true, force: true }); }
  };
  const newContext = async (user = {}) => {
    const context = await browser.newContext({ viewport: { width: 1380, height: 930 }, colorScheme: 'light', acceptDownloads: true, ...user });
    // Broader network is not necessary for this fixture. The host itself additionally has a private network namespace.
    await context.route('http**/*', (route) => (
      new URL(route.request().url()).origin === state.url ? route.continue() : route.abort()
    ));
    return context;
  };
  try {
    const context = await newContext(options.context);
    const page = await context.newPage();
    await page.goto(state.url, { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-theme]').waitFor({ state: 'attached', timeout: 15_000 });
    await page.locator('button').first().waitFor({ state: 'attached', timeout: 15_000 });
    return { state, browser, context, page, newContext, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export const spikeTitle = '主题工坊 · 通道实验';
export const extensionFrame = (page, title = spikeTitle) => page.frameLocator(`iframe[title=${JSON.stringify(title)}]`);
export async function openExtension(page, title = spikeTitle) {
  const iframe = page.locator(`iframe[title=${JSON.stringify(title)}]`);
  if (await iframe.isVisible()) return extensionFrame(page, title);
  const panelEntry = page.locator('[data-context-surface^="plugin:"]').and(page.getByRole('button', { name: title, exact: true })).first();
  if (!(await panelEntry.isVisible())) {
    const toggle = page.getByRole('button', { name: /toggle right sidebar|切换右侧边栏/i }).first();
    if (await toggle.isVisible()) await toggle.click();
  }
  await panelEntry.waitFor({ state: 'visible', timeout: 6000 });
  if (await panelEntry.getAttribute('aria-pressed') !== 'true') await panelEntry.click({ timeout: 6000 });
  const opened = await iframe.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  if (!opened) {
    // Native startup can briefly rehydrate the sidebar selection. Only click
    // again if its control confirms the extension is still closed.
    if (await panelEntry.getAttribute('aria-pressed') !== 'true') await panelEntry.click({ timeout: 6000 });
    await iframe.waitFor({ state: 'visible', timeout: 7000 });
  }
  return extensionFrame(page, title);
}

export async function readCss(page, variables = []) {
  return page.evaluate((names) => {
    const html = document.documentElement;
    const computed = getComputedStyle(html);
    const body = getComputedStyle(document.body);
    return {
      theme: html.getAttribute('data-theme'),
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      bodyFamily: body.fontFamily, bodySize: body.fontSize, bodyWeight: body.fontWeight,
      style: Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name).trim()])),
    };
  }, variables);
}
export const hostVars = ['--primary-base', '--background', '--surface-background', '--radius', '--font-sans', '--font-mono',
  '--font-size-base', '--ui-regular-font-weight', '--ui-padding', '--chat-width'];
export async function debugSummary(page) {
  return page.evaluate(() => ({
    title: document.title,
    buttons: [...document.querySelectorAll('button')].filter((el) => el.getClientRects().length)
      .slice(0, 40).map((el) => (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 100)),
    iframeTitles: [...document.querySelectorAll('iframe')].map((frame) => frame.title),
    text: document.body.innerText.slice(0, 1500),
  }));
}

async function main() {
  const [name = 'local', operation = 'inspect', path, title = spikeTitle] = process.argv.slice(2);
  const fixture = await openFixture(name);
  try {
    if (operation !== 'inspect') await openExtension(fixture.page, title);
    if (operation === 'screenshot') {
      if (!path) throw new Error('screenshot 需要目标文件路径。');
      await fixture.page.screenshot({ path: resolve(path), fullPage: true });
    }
    const css = await readCss(fixture.page, hostVars);
    console.log(JSON.stringify({ css, ...await debugSummary(fixture.page) }, null, 2));
  } finally { await fixture.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
