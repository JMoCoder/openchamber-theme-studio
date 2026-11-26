#!/usr/bin/env node
// Linux-only fixture. Never falls back to launching an unsandboxed OpenChamber.
import { spawn, spawnSync } from 'node:child_process';
import { constants, cpSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, closeSync, lstatSync, renameSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const self = fileURLToPath(import.meta.url);
const root = realpathSync(join(dirname(self), '..'));
const lab = join(root, '.dev-host');
const deps = join(lab, 'runtime', 'deps');
const electron = '/opt/OpenChamber/openchamber';
const bwrap = '/usr/bin/bwrap';
const bridge = join(dirname(self), 'dev-host-bridge.mjs');
const hostPath = process.env.PATH || '/usr/bin:/bin';
const webPort = 27123; // Private namespace only.
const debugPort = 9222; // Never listens in the real host namespace.
const versions = { '@openchamber/web': '2.8.0', '@openchamber/sdk': '2.8.0', 'playwright-core': '1.60.0' };

function inside(path) {
  if (!path.startsWith(`${root}/`)) throw new Error(`拒绝仓库外目录：${path}`);
  let current = root;
  for (const segment of path.slice(root.length + 1).split('/')) {
    current = join(current, segment);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(current).isDirectory()) throw new Error(`拒绝非真实目录：${current}`);
  }
  return path;
}
function executable(name) {
  for (const directory of hostPath.split(':').filter(Boolean)) {
    const candidate = resolve(directory, name);
    try {
      const real = realpathSync(candidate);
      if (statSync(real).isFile() && (statSync(real).mode & 0o111)) return real;
    } catch {}
  }
  throw new Error(`未找到 ${name}；请指定可执行文件路径。`);
}
function mounts({ network = false } = {}) {
  const args = ['--clearenv', '--unshare-all', '--die-with-parent', '--new-session',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  if (network) args.push('--share-net');
  for (const path of ['/usr', '/lib', '/lib64', '/bin', '/opt/OpenChamber']) {
    if (existsSync(path)) args.push('--ro-bind', path, path);
  }
  for (const path of ['/etc/ld.so.cache', '/etc/localtime', '/etc/fonts', '/etc/ssl/certs']) {
    if (existsSync(path)) args.push('--ro-bind', path, path);
  }
  return [...args, '--setenv', 'PATH', '/tools:/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8'];
}
function bootstrap() {
  inside(deps);
  if (Object.entries(versions).every(([pkg, version]) => (
    load(join(deps, 'node_modules', pkg, 'package.json'))?.version === version
  ))) return;
  const runtime = inside(join(lab, 'runtime'));
  inside(join(runtime, 'npm-home'));
  const npm = executable('npm');
  const result = spawnSync(bwrap, [
    ...mounts({ network: true }),
    '--ro-bind', dirname(dirname(npm)), '/npm-ro',
    '--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf',
    '--bind', runtime, '/runtime', '--chdir', '/runtime/deps',
    '--setenv', 'HOME', '/runtime/npm-home',
    '--setenv', 'ELECTRON_RUN_AS_NODE', '1',
    electron, `/npm-ro/bin/${basename(npm)}`,
    'install', '--prefix', '/runtime/deps', '--cache', '/runtime/npm-home/cache',
    '--registry', 'https://registry.npmjs.org/',
    '--userconfig', '/runtime/npm-home/empty-user.npmrc',
    '--globalconfig', '/runtime/npm-home/empty-global.npmrc',
    '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=1', '--save-exact',
    ...Object.entries(versions).map(([pkg, version]) => `${pkg}@${version}`),
  ], { stdio: 'inherit', timeout: 240_000, env: {} });
  if (result.status !== 0) throw new Error('隔离依赖安装失败；未启动宿主。');
}
function load(path) {
  try { return JSON.parse(readFileSync(path, { encoding: 'utf8', flag: constants.O_RDONLY | constants.O_NOFOLLOW })); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function processStart(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19]; } catch { return null; }
}
function isManager(state, dir) {
  if (!state || !Number.isSafeInteger(state.pid) || state.pid < 2 || !state.start) return false;
  if (processStart(state.pid) !== state.start) return false;
  try {
    const args = readFileSync(`/proc/${state.pid}/cmdline`, 'utf8').split('\0');
    return args.includes(self) && args.includes('_serve') && args.includes(dir);
  } catch { return false; }
}
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; ++i) {
    const key = args[i];
    if (key === '--desktop') out.desktop = true;
    else if (key === '--network-test') out.networkTest = true;
    else if (key === '--default-data-dir') out.defaultDataDir = true;
    else if (key === '--manual-install') out.manualInstall = true;
    else if (['--name', '--extension', '--opencode', '--screen'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) {
      out[key.slice(2)] = args[++i];
    } else throw new Error(`未知或缺值的选项：${key}`);
  }
  return out;
}
function stage(dir, source) {
  const from = realpathSync(resolve(source));
  if (!existsSync(join(from, 'package.json'))) throw new Error(`没有扩展 package.json：${from}`);
  const prepared = dirname(from) === join(lab, 'packages') && /^i1-[a-z0-9-]{1,36}$/u.test(basename(from));
  if (from !== root && !prepared && (dir === from || dir.startsWith(`${from}/`) || from.startsWith(`${lab}/`))) {
    throw new Error('请指定扩展目录（.dev-host 内只接受 scripts/build.mjs 生成的独立包）。');
  }
  const target = join(dir, 'extension');
  rmSync(target, { recursive: true, force: true }); // 唯一生成的副本，不触碰源目录。
  const filter = (file) => !['.git', '.agent', '.agents', 'node_modules', 'artifacts', '.dev-host'].includes(basename(file)) &&
    !/^\.env(?:\.|$)|^\.npmrc$/u.test(basename(file)) &&
    // Do not even resolve the targets of entries that are symlinks.
    (() => { const type = lstatSync(file); return type.isFile() || type.isDirectory(); })();
  if (from === root || prepared) {
    mkdirSync(target, { mode: 0o700 });
    for (const path of ['package.json', 'panel', 'LICENSE', 'NOTICE.md']) {
      const file = join(from, path);
      if (existsSync(file)) cpSync(file, join(target, path), { recursive: true, filter });
    }
  } else {
    cpSync(from, target, { recursive: true, filter });
  }
}
async function api(url, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method, signal: AbortSignal.timeout(4_000),
    headers: { Origin: url, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function install(url) {
  const { guest } = await api(url, '/api/guests', {
    method: 'POST', body: { path: '/lab/extension', replace: true },
  });
  if (!guest?.id) throw new Error('宿主没有返回有效的扩展安装结果。');
  const requested = guest.capabilities?.requested ?? [];
  if (requested.length) {
    const result = await api(url, `/api/guests/${encodeURIComponent(guest.id)}/capabilities`, {
      method: 'PUT', body: { granted: requested },
    });
    if (!requested.every((name) => result.guest?.capabilities?.granted?.includes(name))) {
      throw new Error('隔离实例未记录完整授权。');
    }
  }
  return { id: guest.id, granted: requested };
}
function forward(socketPath, { port = 0, cdp = false, networkTest = false } = {}) {
  const eventStreams = new Set();
  const server = createServer((local) => {
    if (networkTest) {
      // Test only: remember which private connection carries SSE, without recording headers.
      local.on('data', (chunk) => {
        if (/^GET \/api\/openchamber\/events[? ]/u.test(chunk.toString('ascii', 0, Math.min(chunk.length, 100)))) {
          eventStreams.add(local);
        }
      });
      local.once('close', () => eventStreams.delete(local));
    }
    const remote = createConnection(socketPath);
    local.once('close', () => remote.destroy());
    remote.once('close', () => local.destroy());
    const fail = () => { local.destroy(); remote.destroy(); };
    remote.on('error', fail);
    local.on('error', fail);
    if (cdp) {
      // Chromium checks Host on /json endpoints; use the isolated loopback host.
      local.once('data', (first) => {
        const headers = first.toString('latin1').replace(/\r\nHost: [^\r\n]+/i, `\r\nHost: 127.0.0.1:${debugPort}`);
        remote.write(Buffer.from(headers, 'latin1'));
        local.pipe(remote);
      });
    } else local.pipe(remote);
    remote.pipe(local);
  });
  server.disconnectEventStreams = () => { for (const local of eventStreams) local.destroy(); };
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}
async function serve(dir, openCode, desktop, networkTest, defaultDataDir, screen) {
  if (dirname(dir) !== join(lab, 'instances') || !/^[a-z0-9][a-z0-9-]{0,19}$/u.test(basename(dir))) {
    throw new Error('拒绝在试件实例目录之外启动内部宿主管理器。');
  }
  const box = join(dir, 'box');
  const socket = join(box, 'web.sock');
  const debugSocket = join(box, 'cdp.sock');
  const faultSocket = join(box, 'fault.sock');
  for (const path of [socket, debugSocket, faultSocket]) {
    if (Buffer.byteLength(path) >= 108) throw new Error('隔离实例套接字路径过长；请缩短仓库路径或 --name。');
    try {
      const file = statSync(path);
      if (!file.isSocket()) throw new Error(`拒绝覆盖非 socket 文件：${path}`);
      rmSync(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const web = await forward(socket, { networkTest });
  const cdp = desktop ? await forward(debugSocket, { cdp: true }) : null;
  const state = {
    pid: process.pid, start: processStart(process.pid), mode: desktop ? 'desktop' : 'web',
    url: `http://127.0.0.1:${web.address().port}`,
    data: box,
    openchamberData: join(box, defaultDataDir ? 'home/.config/openchamber' : 'openchamber'),
    defaultDataDir,
    networkTest,
    ...(screen ? { screen } : {}),
    ...(cdp ? { cdp: `http://127.0.0.1:${cdp.address().port}` } : {}),
  };
  const useVirtualDisplay = desktop && existsSync('/usr/bin/gnome-shell') && existsSync('/usr/bin/dbus-run-session');
  const userFiles = useVirtualDisplay ? ['passwd', 'group', 'machine-id'].flatMap((file) => [
    '--ro-bind', join(dir, 'fake-etc', file), `/etc/${file}`,
  ]) : [];
  const launch = [electron, '/bridge.mjs', desktop ? 'desktop' : 'web', String(webPort), String(debugPort),
    ...(networkTest ? ['network-test'] : [])];
  const child = spawn(bwrap, [
    ...mounts(),
    '--bind', box, '/lab', '--ro-bind', deps, '/deps', '--ro-bind', bridge, '/bridge.mjs',
    '--ro-bind', openCode, '/tools/opencode', '--chdir', '/lab/home/work',
    ...userFiles,
    ...Object.entries({
      HOME: '/lab/home', USER: 'theme-lab', LOGNAME: 'theme-lab', SHELL: '/bin/bash',
      XDG_CONFIG_HOME: '/lab/xdg/config', XDG_CACHE_HOME: '/lab/xdg/cache',
      XDG_DATA_HOME: '/lab/xdg/data', XDG_STATE_HOME: '/lab/xdg/state', XDG_RUNTIME_DIR: '/lab/xdg/run',
      ...(!defaultDataDir ? { OPENCHAMBER_DATA_DIR: '/lab/openchamber' } : {}),
      OPENCHAMBER_RELAY_HOST: 'off',
      OPENCHAMBER_DESKTOP_USER_DATA_DIR: '/lab/electron',
      OPENCHAMBER_OPENCODE_CWD: '/lab/home/work', OPENCHAMBER_OPENCODE_HOSTNAME: '127.0.0.1',
      OPENCODE_CONFIG_DIR: '/lab/xdg/config/opencode', OPENCODE_BINARY: '/tools/opencode',
      OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
      ELECTRON_RUN_AS_NODE: '1',
      ...(useVirtualDisplay ? { DEV_HOST_VIRTUAL_DISPLAY: '1', DEV_HOST_SCREEN: screen ?? '1380x930', GSETTINGS_BACKEND: 'memory',
        XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' } : {}),
    }).flatMap(([key, value]) => ['--setenv', key, value]),
    ...(useVirtualDisplay ? ['/usr/bin/dbus-run-session', '--', ...launch] : launch),
  ], { stdio: ['ignore', 'inherit', 'inherit'], env: {} });
  writeFileSync(join(dir, 'instance.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  const shutdown = () => { child.kill('SIGTERM'); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.on('SIGUSR2', () => {
    if (!networkTest) return;
    web.disconnectEventStreams();
    if (desktop) {
      const request = createConnection(faultSocket, () => request.end());
      request.on('error', (error) => console.error(`Private network test: ${error.message}`));
    }
  });
  child.once('error', (error) => { console.error(error.message); process.exit(1); });
  child.once('exit', (code) => {
    for (const path of [socket, debugSocket, faultSocket]) rmSync(path, { force: true });
    process.exit(code ?? 0);
  });
}
async function start(dir, flags) {
  const statePath = join(dir, 'instance.json');
  if (isManager(load(statePath), dir)) throw new Error('该实例已启动；用 status 查看或 stop 停止。');
  const lock = join(dir, 'start.lock');
  const fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    if (flags.desktop) {
      const packaged = spawnSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'openchamber'], { encoding: 'utf8', env: {} });
      if (packaged.status !== 0 || !/^2\.8\.0(?:$|[-+])/u.test(packaged.stdout.trim())) {
        throw new Error('桌面试件要求 /opt/OpenChamber 由 openchamber 2.8.0 deb 提供；未启动其他版本。');
      }
    }
    const box = inside(join(dir, 'box'));
    const dataSub = flags.defaultDataDir ? 'home/.config/openchamber' : 'openchamber';
    for (const sub of ['home/work', `${dataSub}/themes`, 'electron', 'xdg/config/opencode', 'xdg/cache', 'xdg/data', 'xdg/state', 'xdg/run']) {
      inside(join(box, sub));
    }
    bootstrap();
    stage(box, flags.extension ?? join(root, 'spike'));
    const openCode = flags.opencode ? realpathSync(resolve(flags.opencode)) : executable('opencode');
    const settingsPath = join(box, dataSub, 'settings.json');
    if (flags.desktop) {
      const temp = `${settingsPath}.${process.pid}.fixture`;
      const maximized = flags.screen ? { desktopWindowState: { width: 1280, height: 800, maximized: true } } : {};
      writeFileSync(temp, JSON.stringify({ ...load(settingsPath), ...maximized, desktopLocalPort: webPort, desktopLanAccessEnabled: false }, null, 2),
        { flag: 'wx', mode: 0o600 });
      renameSync(temp, settingsPath);
      const etc = inside(join(dir, 'fake-etc'));
      writeFileSync(join(etc, 'passwd'), `root:x:0:0:root:/root:/bin/sh\ntheme-lab:x:${process.getuid()}:${process.getgid()}:Theme Lab:/lab/home:/bin/bash\n`);
      writeFileSync(join(etc, 'group'), `root:x:0:\ntheme-lab:x:${process.getgid()}:\n`);
      writeFileSync(join(etc, 'machine-id'), `00000000ccd3446281416c50e0a98159\n`);
    }
    const logFd = openSync(join(dir, 'host.log'), 'a', 0o600);
    const child = spawn(process.execPath, [self, '_serve', dir, openCode, flags.desktop ? 'desktop' : 'web',
      ...(flags.networkTest ? ['network-test'] : []), ...(flags.defaultDataDir ? ['default-data-dir'] : []),
      ...(flags.screen ? [flags.screen] : [])], {
      detached: true, stdio: ['ignore', logFd, logFd], env: {},
    });
    closeSync(logFd);
    child.unref();
    let state;
    try {
      for (let i = 0; i < 150; i++) {
        state = load(statePath);
        if (state?.pid === child.pid && isManager(state, dir)) {
          try { if (Array.isArray((await api(state.url, '/api/guests'))?.guests)) break; } catch {}
        }
        if (!processStart(child.pid)) throw new Error('隔离实例提前退出');
        await wait(200);
        if (i === 149) throw new Error('隔离 API 启动超时');
      }
      // Stage the same package either way. A fresh manual fixture leaves Add
      // and the permission decision to the actual Settings UI.
      const extension = flags.manualInstall ? null : await install(state.url);
      console.log(JSON.stringify({ ...state, extension, dir: state.data }, null, 2));
    } catch (error) {
      if (state?.pid === child.pid && isManager(state, dir)) child.kill('SIGTERM');
      throw new Error(`${error.message}；请查看 ${join(dir, 'host.log')}`);
    }
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '_serve') return serve(args[0], args[1], args[2] === 'desktop',
    args.includes('network-test', 3), args.includes('default-data-dir', 3), args.slice(3).find((arg) => /^\d+x\d+$/u.test(arg)));
  if (!['start', 'stop', 'status', 'reload', 'disconnect'].includes(command)) {
    console.log('node scripts/dev-host.mjs start|stop|status|reload|disconnect [--name 名称] [--extension 扩展目录] [--opencode 可执行文件] [--desktop [--screen 宽x高]] [--network-test] [--default-data-dir] [--manual-install]');
    if (command && command !== '--help') process.exitCode = 1;
    return;
  }
  const flags = options(args);
  if (flags.manualInstall && command !== 'start') throw new Error('--manual-install 仅用于 start；请在隔离实例的「设置 → 扩展」中添加 /lab/extension。');
  if (flags.screen) {
    const [w, h] = flags.screen.split('x').map(Number);
    if (command !== 'start' || !flags.desktop || !/^\d{4}x\d{3,4}$/u.test(flags.screen) ||
        w < 1280 || w > 4096 || h < 800 || h > 2160 || !existsSync('/usr/bin/gnome-shell') || !existsSync('/usr/bin/dbus-run-session')) {
      throw new Error('--screen 仅支持带私有 GNOME 显示器的 --desktop start，范围 1280×800–4096×2160。');
    }
  }
  const name = flags.name ?? 'local';
  if (!/^[a-z0-9][a-z0-9-]{0,19}$/u.test(name)) throw new Error('--name 必须为 1–20 位小写字母、数字或连字符。');
  inside(lab);
  inside(join(lab, 'instances'));
  const dir = inside(join(lab, 'instances', name));
  const state = load(join(dir, 'instance.json'));
  const running = isManager(state, dir);
  if (command === 'start') return start(dir, flags);
  if (command === 'status') {
    console.log(JSON.stringify(running ? { ...state, running, dir: state.data ?? dir } : { running, dir }, null, 2));
  } else if (command === 'reload') {
    if (!running) throw new Error('请先启动对应隔离实例。');
    stage(state.data ?? dir, flags.extension ?? join(root, 'spike'));
    console.log(JSON.stringify(await install(state.url)));
  } else if (command === 'disconnect') {
    if (!running || !state.networkTest) throw new Error('仅支持带 --network-test 启动的隔离实例。');
    process.kill(state.pid, 'SIGUSR2');
  } else if (running) {
    process.kill(state.pid, 'SIGTERM'); // Only the exact checked manager PID.
    for (let i = 0; i < 40 && isManager(state, dir); ++i) await wait(100);
    if (isManager(state, dir)) throw new Error(`隔离实例 PID ${state.pid} 未退出；没有扩大终止范围。`);
    console.log(`已停止隔离实例 ${name}（${state.pid}）`);
  } else console.log(`隔离实例 ${name} 未运行`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
