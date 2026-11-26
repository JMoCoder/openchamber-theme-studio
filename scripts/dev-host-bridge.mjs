// Executed inside the private PID, mount, and network namespaces by dev-host.mjs.
import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const [mode, port, debugPort, test] = process.argv.slice(2);
const dataDir = process.env.OPENCHAMBER_DATA_DIR ?? '/lab/home/.config/openchamber';
if (process.env.HOME !== '/lab/home' || !existsSync(`${dataDir}/themes`) ||
    !['/lab/openchamber', '/lab/home/.config/openchamber'].includes(dataDir)) {
  throw new Error('The bridge requires the isolated dev-host mount.');
}
function bridge(name, port) {
  const path = `/lab/${name}.sock`;
  const server = createServer((client) => {
    const upstream = createConnection({ host: '127.0.0.1', port: Number(port) });
    const abort = () => { client.destroy(); upstream.destroy(); };
    client.on('error', abort);
    upstream.on('error', abort);
    client.pipe(upstream).pipe(client);
  });
  server.listen(path, () => chmodSync(path, 0o600));
}
bridge('web', port);
function fixtureDisconnectProxy() {
  // Fault injection only: forward TCP to this private fixture, without altering bodies.
  const eventStreams = new Set();
  const local = createServer((client) => {
    client.on('data', (chunk) => {
      if (/^GET http:\/\/127\.0\.0\.1:27123\/api\/openchamber\/events[? ]/u.test(chunk.toString('ascii', 0, Math.min(chunk.length, 100)))) {
        eventStreams.add(client);
      }
    });
    client.once('close', () => eventStreams.delete(client));
    client.on('error', () => client.destroy());
    client.once('data', (first) => {
      const request = first.toString('latin1', 0, Math.min(first.length, 1024));
      if (!request.startsWith('CONNECT ') && /^\S+ http:\/\/127\.0\.0\.1:27123\//u.test(request)) {
        const upstream = createConnection({ host: '127.0.0.1', port: Number(port) });
        upstream.on('error', () => client.destroy());
        upstream.once('close', () => client.destroy());
        client.once('close', () => upstream.destroy());
        upstream.write(first);
        client.pipe(upstream).pipe(client);
      } else client.destroy();
    });
  });
  local.listen(27124, '127.0.0.1');
  const control = createServer((socket) => {
    for (const client of eventStreams) client.destroy();
    socket.end();
  });
  control.listen('/lab/fault.sock', () => chmodSync('/lab/fault.sock', 0o600));
}
const electron = '/opt/OpenChamber/openchamber';
const env = { ...process.env };
let args = [
  '/deps/node_modules/@openchamber/web/build/bin/cli.js',
  '--foreground', '--host', '127.0.0.1', '--port', port,
];
if (mode === 'desktop') {
  bridge('cdp', debugPort);
  if (test === 'network-test') fixtureDisconnectProxy();
  delete env.ELECTRON_RUN_AS_NODE;
  let platform = 'headless';
  if (env.DEV_HOST_VIRTUAL_DISPLAY === '1') {
    // Private dbus-run-session; the summary bus is a fixture, never the host system bus.
    env.DBUS_SYSTEM_BUS_ADDRESS = env.DBUS_SESSION_BUS_ADDRESS;
    env.WAYLAND_DISPLAY = 'oc-fixture';
    const socket = `${env.XDG_RUNTIME_DIR}/${env.WAYLAND_DISPLAY}`;
    for (const file of [socket, `${socket}.lock`]) rmSync(file, { force: true });
    const compositor = spawn('/usr/bin/gnome-shell',
      ['--headless', '--virtual-monitor', env.DEV_HOST_SCREEN ?? '1380x930', '--wayland', '--no-x11', '--wayland-display', env.WAYLAND_DISPLAY],
      { env, stdio: 'inherit' });
    compositor.once('error', (error) => { console.error(error.message); process.exit(1); });
    compositor.once('exit', () => process.exit(1));
    for (let i = 0; i < 80 && !existsSync(socket); ++i) await wait(50);
    if (!existsSync(socket)) throw new Error('Isolated virtual Wayland display did not start');
    platform = 'wayland';
    env.GDK_BACKEND = 'wayland';
  }
  args = [
    '--user-data-dir=/lab/electron', `--ozone-platform=${platform}`,
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-linux-ui',
    '--disable-background-networking', '--enable-logging=stderr',
    `--remote-debugging-port=${debugPort}`,
    ...(test === 'network-test' ? ['--proxy-server=http://127.0.0.1:27124', '--proxy-bypass-list=<-loopback>'] : []),
  ];
}
const child = spawn(electron, args, { env, stdio: 'inherit' });
child.once('exit', (code) => process.exit(code ?? 1));
child.once('error', (error) => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill('SIGTERM'));
