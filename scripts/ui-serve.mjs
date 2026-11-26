#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureString = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
const json = async (file) => JSON.parse(await readFile(join(root, file), 'utf8'));

/** Node only. This isolated HTTP listener never loads the normal host/profile.
 *  UI_STYLE (or `style`) points at a candidate stylesheet, so a package can be checked before it replaces panel/style.css. */
export async function serveUi({ port = 0, real = true, style = process.env.UI_STYLE } = {}) {
  const directory = await mkdtemp('/tmp/opencode/theme-studio-ui-');
  async function bundle(source, target, extra = []) {
    const output = join(directory, target);
    const build = spawnSync('bun', ['build', source, '--target=browser', '--format=esm', '--minify', `--outfile=${output}`, ...extra],
      { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || String(build.error));
    return readFile(output);
  }
  const [js, realJs, css, source, index, builtinIndex] = await Promise.all([
    bundle('dev/ui-main.mjs', 'fixture.js', ['--external=/fixture-real.js']),
    real ? bundle('dev/ui-real.mjs', 'fixture-real.js') : null,
    readFile(style ? resolve(style) : join(root, 'panel/style.css')), readFile(join(root, 'panel/builtins.js'), 'utf8').catch(() => ''), json('presets/index.json'),
    json('src/data/builtin-index.json').catch(() => []),
  ]);
  const builtins = source ? JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, '')) : {};
  const cards = builtinIndex.filter((card) => Object.values(card.variants).every((entry) => builtins[entry.id]));
  const presets = Object.fromEntries(await Promise.all(index.presets.map(async (card) =>
    [card.slug, Object.fromEntries(await Promise.all(Object.entries(card.variants).map(async ([v, item]) => [v, await json(`presets/${item.file}`)])))])));
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Theme Studio UI fixture</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script id="fixtures" type="application/json">${fixtureString(builtins)}</script><script id="builtin-index" type="application/json">${fixtureString(cards)}</script><script id="presets" type="application/json">${fixtureString(presets)}</script><script type="module" src="/fixture.js"></script></body></html>`;
  const sandbox = (params) => {
    const dimension = (value, fallback) => /^\d{3,4}$/.test(value ?? '') ? Number(value) : fallback;
    const width = dimension(params.get('width'), 420), height = dimension(params.get('height'), 860);
    const guest = new URLSearchParams({ core: params.get('core') === 'fake' ? 'fake' : 'real',
      locale: params.get('locale') === 'zh' ? 'zh' : 'en' });
    if (params.get('clipboard') === 'unavailable') guest.set('scenario', 'clipboardless');
    return `<!doctype html><html lang="en"><title>Panel permission fixture</title><iframe title="Theme Studio" sandbox="allow-scripts" src="/?${guest}" width="${width}" height="${height}"></iframe> <button type="button" id="outside">Host focus</button></html>`;
  };
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url, 'http://fixture');
    const [type, contents] = ({
      '/': ['text/html', html], '/style.css': ['text/css', css], '/fixture.js': ['text/javascript', js],
      ...(realJs ? { '/fixture-real.js': ['text/javascript', realJs], '/sandbox': ['text/html', sandbox(searchParams)] } : {}),
    })[pathname] ?? [];
    response.setHeader('cache-control', 'no-store');
    if (type === 'text/javascript') response.setHeader('access-control-allow-origin', '*');
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'none';");
    if (!type) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); response.end(contents);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, fixtureBytes: js.length, realBytes: realJs?.length, cssBytes: css.length,
    async close() {
      await new Promise((finish) => server.close(finish));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await serveUi({ port: Number(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 0), real: !process.argv.includes('--fake-only') });
  console.log(fixture.url);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void fixture.close(); });
}
