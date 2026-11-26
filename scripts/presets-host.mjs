#!/usr/bin/env node
// Visual evidence for repository-owned isolated fixtures only. Does not attach
// to the user's browser or alter installed code, renderer DOM, or user data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFixture, readCss, repo } from './dev-browser.mjs';

const [name, action, out, filter] = process.argv.slice(2);
assert(/^p-[a-z0-9-]{1,17}$/.test(name ?? ''), '只使用本工作线的 p- 独立实例');
assert(['seed', 'capture', 'editor'].includes(action),
  '用法：node scripts/presets-host.mjs p-<name> seed|capture|editor [截图目录] [逗号分隔的配色 slug]');
const control = join(repo, 'scripts/dev-host.mjs');
const instance = join(await realpath(join(repo, '.dev-host/instances')), name);
const box = join(instance, 'box');
assert((await lstat(box)).isDirectory() && await realpath(box) === box, '拒绝非独立 fixture 数据目录');
const getState = () => JSON.parse(execFileSync(process.execPath, [control, 'status', '--name', name], { encoding: 'utf8' }));
const project = '/lab/home/work/Harbor';
const projectTitle = 'Harbor Notes';
const sampleTitle = 'Cache policy changelog';
const sourcePath = 'src/cache-policy.ts';
const sourceName = 'cache-policy.ts';
const markdown = [
  '### Make freshness visible',
  '',
  'The `maxAge` option now defaults to **30 seconds**. See the [cache guide](https://example.com/cache-policy) for the full policy.',
  '',
  '> Retain stale entries on a temporary network failure.',
  '',
  '```ts',
  '// Keep the unit explicit at the boundary.',
  'type CacheOptions = { maxAge: number; staleOnError: boolean };',
  'const defaults: CacheOptions = { maxAge: 30, staleOnError: true };',
  '',
  'export function cacheKey(path: string): string {',
  '  return "harbor:" + path.toLowerCase();',
  '}',
  '```',
  '',
  '```diff',
  '- const ttl = 60;',
  '+ const maxAge = 30;',
  '```',
].join('\n');
const source = [
  '// Keep the unit explicit at the boundary.',
  'type CacheOptions = { maxAge: number; staleOnError: boolean };',
  'const defaults: CacheOptions = { maxAge: 30, staleOnError: true };',
  '',
  'export function cacheKey(path: string): string {',
  '  return "harbor:" + path.toLowerCase();',
  '}',
  '',
  'export function resolveCache(path: string) {',
  '  return { key: cacheKey(path), ...defaults };',
  '}',
  '',
].join('\n');
const json = (file) => readFile(file, 'utf8').then(JSON.parse);
const cssRgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((v) => parseInt(v, 16)).join(', ')})`;
function cssRgbContrast(first, second) {
  const luminance = (color) => color.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1)
    .map((channel) => Number(channel) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(first), b = luminance(second);
  assert(a !== undefined && b !== undefined, `不是两种实色 RGB：${first} / ${second}`);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function seed() {
  assert(!getState().running, '先仅停止这一隔离实例，再导入合成会话');
  const work = join(box, 'home/work/Harbor');
  await mkdir(join(work, 'src'), { recursive: true });
  await writeFile(join(work, sourcePath), source);
  await writeFile(join(work, 'README.md'), '# Harbor Notes\nLocal design fixture; no network or model calls.\n');
  // v2 CLI's export/import envelope. The fixture is synthetic and uses no
  // assistant execution, provider authentication, or external API.
  const old = await json(join(box, 'openchamber/settings.json'));
  const stamp = Date.now();
  const projectId = `path_${Buffer.from(project).toString('base64url')}`;
  const settings = { ...old, projects: [{ id: projectId, path: project, label: projectTitle, addedAt: stamp }],
    activeProjectId: projectId };
  await writeFile(join(box, 'openchamber/settings.json'), JSON.stringify(settings, null, 2));
  const opencode = execFileSync('/usr/bin/which', ['opencode'], { encoding: 'utf8' }).trim();
  const binary = await realpath(opencode);
  const mounts = ['/usr','/lib','/lib64','/bin'].flatMap((path) => ['--ro-bind',path,path]);
  const env = {
    HOME: '/lab/home', USER: 'theme-lab', PATH: '/usr/bin:/bin',
    XDG_CONFIG_HOME: '/lab/xdg/config', XDG_DATA_HOME: '/lab/xdg/data', XDG_CACHE_HOME: '/lab/xdg/cache',
    XDG_STATE_HOME: '/lab/xdg/state', XDG_RUNTIME_DIR: '/lab/xdg/run', OPENCODE_CONFIG_DIR: '/lab/xdg/config/opencode',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  };
  const ids = ['ses_deeaaa64dffff6KXr61UPaT79X', 'ses_deeaaa64effffz97n49EGwi3gJ',
    'ses_deeaaa64fffffYnxDI2lpR7CA', 'ses_deeaaa650ffffsi2U9wlkExbTm'];
  const user = 'msg_6f8d59b3b0001uL26LWh3stcc0';
  const bot = 'msg_6f8d59b3ec001P00UaOVzyoD3L';
  const rows = ['Read source notes','API usage audit','Release notes outline',sampleTitle];
  const cost = 0, tokens = { input: 44, output: 216, reasoning: 0, cache: { read: 0, write: 0 } };
  const model = { providerID: 'opencode', id: 'big-pickle' };
  for (const [i, title] of rows.entries()) {
    const sessionID = ids[i], now = stamp - (rows.length - i) * 1500;
    const info = { id: sessionID, title, location: { directory: project }, time: { created: now, updated: now + 500 },
      projectID: 'global', cost, tokens };
    const messages = [];
    if (title === sampleTitle) {
      const userText = 'Review the cache defaults and make the freshness rule explicit.';
      messages.push({
        id: user, type: 'user', time: { created: now + 20 }, text: userText,
      }, {
        id: bot, type: 'assistant', time: { created: now + 60, completed: now + 500 },
        model, agent: 'build', cost, tokens, finish: 'stop', content: [{ type: 'text', text: markdown }],
      });
    }
    const file = join(box, `preset-sample-${i}.json`);
    try {
      await writeFile(file, JSON.stringify({ info, messages }), { flag: 'wx' });
      execFileSync('/usr/bin/bwrap', [
        '--unshare-all','--die-with-parent','--clearenv','--proc','/proc','--dev','/dev','--tmpfs','/tmp',...mounts,
        '--bind',box,'/lab','--ro-bind',binary,'/opencode',
        ...Object.entries(env).flatMap(([key,val]) => ['--setenv',key,val]), '--chdir',project,
        '/opencode','session','import','--standalone','--directory',project,`/lab/preset-sample-${i}.json`,
      ], { env: {}, stdio: 'inherit', timeout: 14000 });
    } finally { await unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
  }
}

async function capture() {
  assert(out, '必须指定隔离截图目录');
  const folder = resolve(out ?? '');
  const parent = await realpath(resolve(folder, '..'));
  assert(parent === '/tmp/opencode' || parent.startsWith('/tmp/opencode/') || parent.startsWith(`${instance}/`),
    '原图只写入此隔离实例或 /tmp/opencode 的工作目录');
  await mkdir(folder, { recursive: true });
  assert((await lstat(folder)).isDirectory(), '原图目录不可是符号链接');
  const description = await json(join(repo, 'presets/index.json'));
  const requested = filter?.split(',') ?? [];
  const themes = description.presets.filter(({ slug }) => !requested.length || requested.includes(slug));
  assert(themes.length, '没有匹配的预设');
  assert(requested.every((slug) => themes.some((p) => p.slug === slug)), '包含未知配色 slug');
  const x = await openFixture(name);
  const { page, state } = x;
  let count = 0;
  function waitColor(role, color) {
    return page.waitForFunction(([role,color]) =>
      getComputedStyle(document.documentElement).getPropertyValue(role).trim() === color, [role,color], { timeout: 8000 });
  }
  async function appearance() {
    if (!(await page.getByRole('radio', { name: 'System', exact: true }).isVisible())) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByText('Appearance', { exact: true }).first().click();
    }
  }
  async function closeSettings() {
    const close = page.getByRole('button', { name: /^close settings$/i }).first();
    if (!(await close.isVisible())) return;
    await page.keyboard.press('Escape');
    if (await close.waitFor({ state: 'hidden', timeout: 1800 }).then(() => true, () => false)) return;
    await close.click({ timeout: 2600 });
    await close.waitFor({ state: 'hidden', timeout: 3000 });
  }
  async function openEditor() {
    const contents = page.locator('.cm-content').filter({ hasText: 'export function resolveCache' });
    if (await contents.isVisible()) return contents;
    const editor = page.locator('[data-context-surface="editor"]').first();
    if (await editor.getAttribute('aria-pressed') !== 'true') await editor.click({ timeout: 4500 });
    // The rail and the tree have separate persisted states. A previous
    // capture may reopen Editor with its tree still collapsed.
    const tree = page.getByRole('button', { name: 'Toggle file tree', exact: true });
    const file = page.locator(`[data-file-tree-path$="/${sourcePath}"]`).getByText(sourceName, { exact: true }).first();
    const tab = page.getByRole('tab', { name: sourceName, exact: true }).first();
    if (await tab.isVisible()) {
      await tab.click({ timeout: 4500 });
      const showEditor = page.getByRole('button', { name: 'Toggle file editor', exact: true });
      if (await showEditor.isVisible() && await showEditor.getAttribute('aria-pressed') === 'false') {
        await showEditor.click({ timeout: 4500 });
      }
    } else {
      if (!(await file.isVisible())) {
        if (await tree.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)
          && await tree.getAttribute('aria-pressed') === 'false') await tree.click({ timeout: 4500 });
        if (!(await file.isVisible())) await page.getByText('src', { exact: true }).first().click({ timeout: 5000 });
      }
      await file.dblclick({ timeout: 5500 });
    }
    await contents.waitFor({ state: 'visible', timeout: 9000 });
    return contents;
  }
  const shot = async (slug, variant, view) => page.screenshot({
    path: join(folder, `${slug}-${variant}-${view}.jpg`), type: 'jpeg', quality: 90, animations: 'disabled', timeout: 8000,
  });
  try {
    assert.equal(await realpath(state.dir), box);
    assert.equal(state.mode, 'desktop');
    assert.notEqual(new URL(state.url).port, '57123');
    const themesDir = join(box, 'openchamber/themes');
    assert((await lstat(themesDir)).isDirectory());
    for (const p of description.presets) for (const { file } of Object.values(p.variants)) {
      assert(/^[a-z0-9-]+\.json$/.test(file));
      const staged = join(themesDir, `${file}.p-fixture`);
      await copyFile(join(repo, 'presets', file), staged);
      await rename(staged, join(themesDir, file));
    }
    await closeSettings();
    await page.reload({waitUntil:'domcontentloaded'});
    const session = page.locator('[data-session-row-main]').filter({ hasText: sampleTitle }).first();
    if (!(await session.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false))) {
      const button = page.getByRole('button', { name: projectTitle, exact: true }).first();
      if (await button.isVisible()) await button.click();
    }
    await session.waitFor({ state: 'visible', timeout: 9000 });
    // The disabled ARIA wrapper is the drag handle; a pointer click still
    // activates the inner, independent session-open action.
    const target = await session.boundingBox();
    assert(target);
    await page.mouse.click(target.x + target.width * .40, target.y + target.height / 2);
    await page.getByText('Make freshness visible', {exact: true}).waitFor({timeout: 9000});
    const editorPane = page.locator('[data-context-surface="editor"]').first();
    const editorText = page.locator('.cm-content').filter({ hasText: 'export function resolveCache' });
    if (action === 'capture') {
      // Do not inherit a file pane from a previous editor run. The thumbnail
      // walls must compare the same full conversation in every variant.
      if (await editorPane.getAttribute('aria-pressed') === 'true') await editorPane.click();
      await editorText.waitFor({ state: 'hidden', timeout: 5000 });
    }
    const fileEditor = action === 'editor' ? await openEditor() : null;
    for (const p of themes) {
      for (const [variant, { id, file, swatches }] of Object.entries(p.variants)) {
        await appearance();
        await page.getByRole('radio', { name: variant === 'light' ? 'Light' : 'Dark', exact: true }).click();
        const row = page.locator(`[data-theme-id=${JSON.stringify(id)}]`);
        await row.waitFor({ timeout: 8000 });
        await row.click();
        await waitColor('--primary-base', swatches.primary);
        assert.equal(await row.getAttribute('aria-selected'), 'true');
        const { colors: c } = await json(join(repo, 'presets', file));
        const props = ['--surface-background','--surface-muted','--surface-muted-foreground','--interactive-selection','--interactive-border',
          '--markdown-link','--chat-user-message-bg','--syntax-keyword','--pr-open','--pr-draft','--pr-blocked','--pr-merged','--pr-closed'];
        const actual = await readCss(page, props);
        assert.equal(actual.theme, variant);
        assert.deepEqual(Object.values(actual.style), [swatches.canvas, swatches.sidebar, c.surface.mutedForeground,
          c.interactive.selection, c.interactive.border, swatches.secondary, swatches.bubble, c.syntax.base.keyword,
          ...['open','draft','blocked','merged','closed'].map((k) => c.pr[k])]);
        if (action === 'capture') await shot(p.slug, variant, 'settings');
        await closeSettings();
        await page.getByText('Make freshness visible', {exact: true}).waitFor({timeout: 6000});
        assert(await session.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," oc-selected ")]').count(),
          `${id} no native detail row selected`);
        const codeFence = page.locator('[data-streamdown="code-block"]').first();
        assert.equal(await codeFence.evaluate((e) => getComputedStyle(e).backgroundColor),
          cssRgb(c.surface.elevated), `${id} Markdown fenced code paint`);
        if (fileEditor) {
          assert.equal(await fileEditor.evaluate((e) => getComputedStyle(e.closest('.cm-scroller')).backgroundColor),
            cssRgb(c.syntax.base.background), `${id} file editor paint`);
          // Give the native editor a compact, inspectable selection without
          // modifying the fixture document. The adjacent code stays legible.
          const codeLine = fileEditor.locator('.cm-line').filter({ hasText: 'const defaults:' });
          const target = await codeLine.evaluate((line) => {
            for (const label of line.querySelectorAll('span')) {
              if (label.textContent === 'defaults') {
                const rect = label.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              }
            }
            return null;
          });
          if (target) {
            await page.mouse.dblclick(target.x, target.y);
            const decoration = await fileEditor.evaluate((contents) => {
              const editor = contents.closest('.cm-editor');
              const selection = editor.querySelector('.cm-selectionBackground');
              const gutter = editor.querySelector('.cm-activeLineGutter');
              const word = [...contents.querySelectorAll('.cm-line span')].find((span) => span.textContent === 'defaults');
              return {
                selection: selection ? getComputedStyle(selection).backgroundColor : null,
                ink: word ? getComputedStyle(word).color : null,
                activeLineGutter: gutter ? getComputedStyle(gutter).color : null,
              };
            });
            if (decoration.selection && decoration.ink) {
              const ratio = cssRgbContrast(decoration.selection, decoration.ink);
              assert(ratio >= 4.5, `${id} native file selection sample ${ratio.toFixed(2)}:1`);
              console.log(`${id} · editor sample ${ratio.toFixed(2)}:1 · actual paint ${JSON.stringify(decoration)} · authored selection ${c.interactive.selection}`);
            }
          }
          await shot(p.slug, variant, 'editor');
          console.log(`${id} · native theme selection / CSS match · file editor and Markdown backplates verified`);
        } else {
          await shot(p.slug, variant, 'chat');
          console.log(`${id} · native row selected · 13 CSS tokens match · chat / settings`);
        }
        count++;
      }
    }
    console.log(`Captured ${count} variants in the installed desktop renderer (private display).`);
  } finally { await x.close(); }
}

if (action === 'seed') await seed(); else await capture();
