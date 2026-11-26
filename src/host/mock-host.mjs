import defaults from '../data/builtin-defaults.json' with { type: 'json' };
import { tokensForTheme } from './identify.mjs';
import { problem } from './library.mjs';
import { byteLength } from './persistence.mjs';

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const folders = ['~/.config/openchamber/themes', '~/Downloads', '~/下载'];
const pathPattern = /^(?:~\/\.config\/openchamber\/themes\/theme-studio-|~\/(?:Downloads|下载)\/openchamber-theme-studio-)[^/]*\.json$/u;
const absolutePath = (path) => typeof path === 'string' && (folders.includes(path) || pathPattern.test(path));
const systemTimers = { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id) };

export function createMockWorkspace({
  delay = 2000, directories = folders, definitions = {}, timers = systemTimers,
  now = Date.now, maxStorage = 2_097_152,
} = {}) {
  const files = new Map(), dir = new Set(directories), values = new Map(), clients = new Set();
  const nativeThemes = new Map([...Object.values(defaults), ...Object.values(definitions)]
    .map((theme) => [theme.metadata.id, theme]));
  let themes = new Map(nativeThemes), writeTimer = null;
  function refresh() {
    themes = new Map(nativeThemes);
    const imported = new Set();
    for (const [path, value] of files) {
      if (!path.startsWith('~/.config/openchamber/themes/')) continue;
      try {
        const theme = JSON.parse(value.content);
        const id = theme.metadata.id;
        if (!imported.has(id)) {
          tokensForTheme(theme);
          themes.set(id, theme);
          imported.add(id);
        }
      } catch { /* Fixture can simulate invalid/stale content. */ }
    }
    for (const client of clients) client.emit();
  }
  function schedule() {
    if (writeTimer !== null) timers.clearTimeout(writeTimer);
    writeTimer = timers.setTimeout(() => { writeTimer = null; refresh(); }, delay);
  }
  const workspace = {
    dir, values, files, schedule, refresh, clients,
    now, timers, maxStorage,
    theme: (id, mode) => themes.get(id) ?? defaults[mode],
    addTheme(theme) { nativeThemes.set(theme.metadata.id, theme); refresh(); },
    putFile(path, content) { files.set(path, { content, mtime: now() }); schedule(); },
    removeFile(path) { files.delete(path); schedule(); },
    uninstall() { values.clear(); },
  };
  return workspace;
}

export function createMockHost(options = {}) {
  const workspace = options.workspace ?? createMockWorkspace(options);
  const { files, values, dir, timers, now } = workspace;
  const listeners = new Set();
  const selected = { light: 'openchamber-light', dark: 'openchamber-dark', ...options.selected };
  let granted = options.granted !== false, supported = options.supported !== false;
  let system = options.system ?? 'light', mode = options.mode ?? 'system', locale = options.locale ?? 'en';
  let held = false, heldSnapshots = [], last = null, failNext = null;
  const writes = [], toasts = [];
  let clipboard = '', writeDelay = options.writeDelay ?? 0;
  function validate(path) {
    if (!supported) throw problem('NOT_SUPPORTED', 'Filesystem unavailable in this host');
    if (!granted) throw problem('NOT_GRANTED', 'Filesystem authorization missing');
    if (!absolutePath(path)) throw problem('BAD_PATH', 'Path outside mock manifest');
  }
  const deliver = (message) => {
    last = message;
    for (const listener of listeners) listener(clone(message));
  };
  function snapshot() {
    const current = mode === 'system' ? system : mode;
    const theme = workspace.theme(selected[current], current);
    return { locale, surface: 'panel', theme: { mode: current, tokens: {
      ...tokensForTheme(theme), background: theme.colors.surface.background,
      font: 'system-ui', mono: 'monospace', fontSize: '16px',
    } } };
  }
  function emit({ delay = 0 } = {}) {
    if (options.oldHost) return;
    const ready = snapshot();
    if (held) heldSnapshots.push(ready);
    else if (delay) timers.setTimeout(() => deliver(ready), delay);
    else deliver(ready);
  }
  const entry = { emit };
  workspace.clients.add(entry);
  const host = {
    onReady(listener) {
      listeners.add(listener);
      if (!options.oldHost) {
        if (last) listener(clone(last));
        else emit();
      }
      return () => listeners.delete(listener);
    },
    async stat(path) {
      validate(path);
      const existing = files.get(path);
      return existing ? { kind: 'file', size: byteLength(existing.content), mtime: existing.mtime }
        : dir.has(path) ? { kind: 'directory', size: 0, mtime: 0 } : { kind: 'missing', size: 0, mtime: 0 };
    },
    async readFile(path) {
      validate(path);
      if (!files.has(path)) throw problem('NOT_FOUND', 'No file at that path');
      return { content: files.get(path).content };
    },
    async writeFile(path, content) {
      validate(path);
      const fault = failNext;
      failNext = null;
      if (writeDelay) await new Promise((resolve) => timers.setTimeout(resolve, writeDelay));
      if (fault && !fault.after) throw fault.error;
      if (dir.has(path)) throw problem('BAD_PATH', 'That path is a directory');
      dir.add(path.slice(0, path.lastIndexOf('/')));
      writes.push({ path, content, at: now() });
      workspace.putFile(path, content);
      if (fault) throw fault.error;
      return { written: true };
    },
    async listDir(path) {
      validate(path);
      if (!dir.has(path)) throw problem('NOT_FOUND', 'No directory at that path');
      return { entries: [...files.keys()].filter((file) => file.slice(0, file.lastIndexOf('/')) === path)
        .map((file) => ({ kind: 'file', name: file.split('/').at(-1) })).sort((a, b) => a.name.localeCompare(b.name)) };
    },
    storage: {
      async get(key) { return clone(values.get(key)); },
      async set(key, value) {
        if (!key || key.length > 128 || byteLength(JSON.stringify(value)) > 65_536) throw problem('STORAGE_QUOTA', 'Storage value too large');
        const bytes = [value, ...[...values].filter(([k]) => k !== key).map(([, v]) => v)]
          .reduce((sum, item) => sum + byteLength(JSON.stringify(item)), 0);
        if (bytes > workspace.maxStorage || (!values.has(key) && values.size >= 2000)) throw problem('STORAGE_QUOTA', 'Storage quota exceeded');
        values.set(key, clone(value));
      },
      async delete(key) { values.delete(key); },
      async keys() { return [...values.keys()]; },
    },
    async writeClipboard(text) { clipboard = text; },
    async toast(message) { toasts.push(clone(message)); },
    async openUrl(url) { return url; },
    dispose() { workspace.clients.delete(entry); listeners.clear(); },
    control: {
      workspace, writes, toasts, snapshot,
      clipboard: () => clipboard,
      setSystem(next) { system = next; emit(); },
      setMode(next) { mode = next; emit(); },
      select(id, variant = snapshot().theme.mode) { selected[variant] = id; emit(); },
      locale(next) { locale = next; emit(); },
      setGranted(value) { granted = value; emit(); },
      setSupported(value) { supported = value; emit(); },
      writeDelay(ms) { writeDelay = ms; },
      failWrite(error = problem('DENIED', 'Fixture write failed'), { after = false } = {}) { failNext = { error, after }; },
      editFile: (path, content) => workspace.putFile(path, content),
      deleteFile: (path) => workspace.removeFile(path),
      push: (ready) => deliver(ready),
      emit,
      hold() { held = true; },
      release({ reverse = false } = {}) {
        held = false;
        if (reverse) heldSnapshots.reverse();
        for (const ready of heldSnapshots) deliver(ready);
        heldSnapshots = [];
      },
    },
  };
  return host;
}
