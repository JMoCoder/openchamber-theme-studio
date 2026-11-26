import { compactThemeLossless, inspectThemeImport, parseTheme } from '../../shared/theme-core.mjs';
import { object, normalizeProject, onlyVariants, projectForNative, resolveProject, titleOf, variants } from '../core/project.mjs';
import { byteLength } from './persistence.mjs';
import { isPlaceholderOperator, themeKey } from './identify.mjs';
import { acquireLease, problem } from './lease.mjs';
export { problem } from './lease.mjs';

export const themesDir = '~/.config/openchamber/themes';
export const slotId = (v) => `theme-studio-live-${v}`;
export const slotPath = (v) => `${themesDir}/${slotId(v)}.json`;
export const isPreviewWriter = (id) => typeof id === 'string' && /^preview-[\w-]{1,120}$/u.test(id);
const isRestoredWriter = (id) => typeof id === 'string' && /^restored-[\w-]{1,119}$/u.test(id);
const validOwnedFile = /^theme-studio-[a-z0-9][a-z0-9-]{0,70}-(?:light|dark)\.json$/u;
const maxImport = 512 * 1024;
// Only live previews can include a second file. Quoting valid JSON can at
// most double its byte count; leave the normal theme/import limit unchanged.
const maxPreview = 3 * maxImport + 256;
const errorText = (e) => e?.message || String(e);
function equalTree(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalTree(a[key], b[key]));
}
export const errorCode = (error) => error?.code ?? 'WRITE_FAILED';
export const fsUnavailable = (error) => ['NOT_GRANTED', 'HOST_UNAVAILABLE', 'NOT_SUPPORTED', 'UNKNOWN_TYPE'].includes(error?.code);

export async function readPath(host, path, knownStatus) {
  const status = knownStatus ?? await host.stat(path);
  if (status.kind === 'missing') return null;
  if (status.kind !== 'file') throw problem('BAD_PATH', 'Not a regular file');
  const result = await host.readFile(path).catch(async (error) => {
    if (error.code === 'NOT_FOUND' && (await host.stat(path)).kind === 'missing') return null;
    throw error;
  });
  if (!result) return null;
  if (typeof result.content !== 'string') throw problem('BAD_RESPONSE', 'Host did not return file content');
  return result.content;
}

export function encodeTheme(theme, project, { id, name, writer, rev, borrowedApplied, borrowBaseline, previewVariant, probeBefore, previewBackup }, { compact = true } = {}) {
  const definition = compact ? compactThemeLossless(theme) : theme;
  const borrow = borrowedApplied === true ? { borrowedApplied: true, ...(borrowBaseline ? { borrowBaseline } : {}) } : {};
  const value = { ...definition, metadata: { ...definition.metadata, id, name },
    themeStudio: { schemaVersion: 1, project, rev, writer, ...borrow,
      ...(variants.includes(previewVariant) ? { previewVariant } : {}), ...(probeBefore ? { probeBefore } : {}) } };
  const raw = `${JSON.stringify(value)}\n`;
  if (byteLength(raw) > maxImport) throw problem('FILE_TOO_LARGE', 'Theme Studio JSON exceeds 512 KiB');
  if (!previewBackup) return raw;
  value.themeStudio.origin = { writer: previewBackup.id, raw: previewBackup.raw };
  const journaled = `${JSON.stringify(value)}\n`;
  if (byteLength(journaled) > maxPreview) throw problem('FILE_TOO_LARGE', 'Theme Studio preview and original exceed the file limit');
  return journaled;
}

function envelope(value) {
  const data = value?.themeStudio;
  if (!object(data) || data.schemaVersion !== 1 || !Number.isSafeInteger(data.rev) || data.rev < 1 ||
    typeof data.writer !== 'string' || !/^[\w-]{1,128}$/u.test(data.writer)) return null;
  try {
    const borrowBaseline = typeof data.borrowBaseline === 'string' && data.borrowBaseline.length <= 128 ? data.borrowBaseline : null;
    return { project: normalizeProject(data.project), rev: data.rev, writer: data.writer,
      borrowedApplied: data.borrowedApplied === true, borrowBaseline,
      origin: data.origin,
      previewVariant: variants.includes(data.previewVariant) ? data.previewVariant : undefined,
      probeBefore: isPreviewWriter(data.writer) && typeof data.probeBefore === 'string' && data.probeBefore.length <= 8192
        ? data.probeBefore : undefined };
  } catch { return null; }
}

export function decodeOwned(raw, variant, { allowPreviewSize = false } = {}) {
  try {
    if (typeof raw !== 'string') return null;
    const size = byteLength(raw);
    if (size > (allowPreviewSize ? maxPreview : maxImport)) return null;
    const value = JSON.parse(raw);
    const owned = envelope(value);
    if (!owned || size > maxImport && !isPreviewWriter(owned.writer)) return null;
    // The app intentionally ignores this sidecar. Import warnings describe
    // actual unknown theme keys, never our recognized metadata.
    const { themeStudio, ...theme } = value;
    const { definition } = inspectThemeImport(theme);
    if (!definition || definition.metadata.variant !== variant) return null;
    const { id, name } = definition.metadata;
    return { ...owned, id, name, variant, key: themeKey(definition), definition };
  } catch { return null; }
}

export function inspectImportText(text, filename = '') {
  if (typeof text !== 'string' || byteLength(text) > maxImport) return { ok: false, code: 'FILE_TOO_LARGE', filename };
  try {
    const input = JSON.parse(text.replace(/^\uFEFF/u, ''));
    if (object(input) && !input.metadata && (Array.isArray(input.tokenColors) || typeof input.colors?.['editor.background'] === 'string')) {
      return { ok: false, code: 'VSCODE_THEME', filename };
    }
    if (!object(input)) return { ok: false, code: 'INVALID_THEME', filename };
    const owned = envelope(input);
    const { themeStudio, ...theme } = input;
    const source = owned ? theme : input;
    const result = inspectThemeImport(source);
    if (!result.definition) return { ok: false, code: 'INVALID_THEME', filename, ...result };
    const { definition, warnings } = result;
    const omitted = new Set(warnings.map(({ path }) => JSON.stringify(path)));
    function warnDropped(raw, clean, path = []) {
      if (!object(raw) || !object(clean)) return;
      for (const key of Object.keys(raw)) {
        const at = [...path, key];
        if (Object.hasOwn(clean, key)) warnDropped(raw[key], clean[key], at);
        else if (!omitted.has(JSON.stringify(at))) warnings.push({ path: at, code: 'unknown_key', message: 'Unsupported theme key ignored' });
      }
    }
    warnDropped(source, definition);
    const variant = owned?.previewVariant ?? definition.metadata.variant;
    const paintedAcrossModes = variant !== definition.metadata.variant;
    let project = owned?.project;
    let edition, placeholder = false;
    try {
      if (project) {
        const native = parseTheme(definition);
        edition = resolveProject(project, variant, { compact: false });
        const embedded = parseTheme(edition);
        if (!paintedAcrossModes && definition.metadata.id === slotId(variant) && isRestoredWriter(owned.writer) &&
            isPlaceholderOperator(embedded.colors.syntax.base.operator, native.colors.syntax.base.operator)) {
          native.colors.syntax.base.operator = embedded.colors.syntax.base.operator;
          placeholder = true;
        }
        if (!equalTree(native.colors, embedded.colors) || !equalTree(native.config, embedded.config)) project = null;
      }
    } catch { project = null; }
    // A preview file advertises the window's mode for the host, not its
    // edition's mode. Never import a stale painted file as that native mode.
    if ((paintedAcrossModes || isPreviewWriter(owned?.writer)) && !project) return { ok: false, code: 'INVALID_THEME', filename, issues: [{
      path: ['themeStudio', 'project'], message: 'The window preview does not match its editable edition',
    }] };
    if (owned && !project) warnings.push({ path: ['themeStudio'], code: 'stale_project', message: 'Editable layers disagree with the actual theme; native colors were kept' });
    return { ok: true, filename, ...result, definition: project && (paintedAcrossModes || placeholder) ? edition : definition,
      project: project ?? projectForNative(definition), variant };
  } catch (e) {
    return { ok: false, code: 'INVALID_JSON', filename, message: errorText(e) };
  }
}

const slugify = (name) => name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 42).replace(/-$/u, '') || 'workshop';
const safeSlug = (name) => { const slug = slugify(name); return slug === 'live' ? 'workshop-live' : slug; };
const resultFor = (files, errors) => ({ ok: errors.length === 0, files, paths: files.map(({ path }) => path), errors, code: errors[0]?.code });
const bad = (code, message) => resultFor([], [{ code, message }]);
const variantOfFile = (filename) => filename.endsWith('-dark.json') ? 'dark' : 'light';
const stemOf = (id) => id.replace(/-(?:light|dark)$/u, '');
const savedStem = (stem) => typeof stem === 'string' && stem !== 'theme-studio-live' &&
  validOwnedFile.test(`${stem}-light.json`);
const removedKey = (stem) => `studio:removed:${stem}`;
// A preference identifies this edition of a work, not everything ever saved
// under its filename. Keep the native file in theme identification candidates.
const edition = (record, stat) => JSON.stringify([record.project.id, record.writer, record.rev, stat.mtime, stat.size]);

function cardFiles(card) {
  if (!savedStem(card?.id)) throw problem('BAD_PATH', 'Not a saved work');
  const entries = Object.entries(card.variants ?? {});
  if (!entries.length || entries.length > variants.length) throw problem('BAD_PATH', 'No saved variants');
  return entries.map(([v, item]) => {
    const id = `${card.id}-${v}`, path = `${themesDir}/${id}.json`;
    if (!variants.includes(v) || item?.id !== id || item.path !== path) throw problem('BAD_PATH', 'Unexpected saved theme path');
    return path;
  });
}

export function createLibrary({ host, writer, now, timers, settle }) {
  let queue = Promise.resolve();
  const serial = (work) => {
    const op = queue.then(work);
    queue = op.catch(() => {});
    return op;
  };
  async function scan() {
    const { entries } = await host.listDir(themesDir);
    const names = entries.filter(({ name, kind }) => kind === 'file' && validOwnedFile.test(name) &&
      !variants.some((v) => name === `${slotId(v)}.json`)).map(({ name }) => name);
    const records = [];
    for (let i = 0; i < names.length; i += 6) {
      const batch = await Promise.allSettled(names.slice(i, i + 6).map(async (name) => {
        const path = `${themesDir}/${name}`, status = await host.stat(path);
        const raw = await readPath(host, path, status);
        const record = decodeOwned(raw, variantOfFile(name));
        return record?.id === name.slice(0, -5) && !record.previewVariant && !isPreviewWriter(record.writer)
          ? { ...record, path, edition: edition(record, status) } : null;
      }));
      records.push(...batch.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []));
    }
    if (!records.length) return records;
    const keys = new Set(await host.storage.keys());
    const stems = [...new Set(records.map(({ id }) => stemOf(id)))].filter((stem) => keys.has(removedKey(stem)));
    const markers = new Map(await Promise.all(stems.map(async (stem) => [stem, await host.storage.get(removedKey(stem))])));
    return records.map((record) => ({ ...record, removed: markers.get(stemOf(record.id))?.[record.variant] === record.edition }));
  }
  async function setRemoved(stem, records, removed) {
    if (!savedStem(stem)) return { ok: false, code: 'BAD_PATH' };
    try {
      const key = removedKey(stem);
      if (removed) {
        const group = records.filter((r) => stemOf(r.id) === stem);
        if (!group.length) return { ok: false, code: 'NOT_FOUND' };
        const marker = {};
        for (const r of group) {
          const status = await host.stat(r.path);
          if (status.kind !== 'file' || edition(r, status) !== r.edition) return { ok: false, code: 'CONFLICT' };
          marker[r.variant] = r.edition;
        }
        await host.storage.set(key, marker);
      } else {
        await host.storage.delete(key);
      }
      return { ok: true, id: stem };
    } catch (error) { return { ok: false, code: errorCode(error) }; }
  }
  async function checkSavedFiles(card) {
    const remaining = [], missing = [];
    try {
      const paths = cardFiles(card);
      if ((await host.stat(themesDir)).kind !== 'directory') throw problem('NO_THEME_DIRECTORY', 'Theme directory is unavailable');
      for (const path of paths) {
        const { kind } = await host.stat(path);
        if (kind === 'missing') missing.push(path);
        else if (kind === 'file') remaining.push(path);
        else throw problem('BAD_PATH', 'Expected a regular theme file');
      }
      return { ok: true, remaining, missing };
    } catch (error) { return { ok: false, code: errorCode(error), remaining, missing }; }
  }
  async function uniquePlan({ directory, prefix, name, selected }) {
    const base = safeSlug(name);
    for (let index = 1; index < 1000; ++index) {
      const stem = `${prefix}-${base}${index === 1 ? '' : `-${index}`}`;
      const entries = selected.map((variant) => ({ variant, id: `${stem}-${variant}`, path: `${directory}/${stem}-${variant}.json` }));
      const stats = await Promise.all(entries.map(({ path }) => host.stat(path)));
      if (stats.every(({ kind }) => kind === 'missing')) return entries;
    }
    throw problem('NAME_TAKEN', 'Could not find a free filename');
  }
  async function write(kind, { project, themes, name = project.name, requested, locale = 'en' }) {
    const selected = onlyVariants(requested);
    if (!selected.length) return bad('EMPTY_VARIANTS', 'Select one or both variants');
    const files = [], errors = [];
    const label = titleOf(name) || project.name;
    let lease;
    try {
      let directory = themesDir;
      if (kind === 'export') {
        const folders = locale === 'zh' ? ['~/下载', '~/Downloads'] : ['~/Downloads', '~/下载'];
        directory = null;
        for (const folder of folders) if ((await host.stat(folder)).kind === 'directory') { directory = folder; break; }
        if (!directory) return bad('NO_DOWNLOAD_DIRECTORY', 'No existing download directory; copy JSON instead');
      } else if ((await host.stat(directory)).kind !== 'directory') {
        return bad('NO_THEME_DIRECTORY', 'Default host theme directory is not available');
      }
      lease = await acquireLease(host.storage, 'studio:lease:library', { writer, now, timers, settle });
      const entries = await uniquePlan({ directory, prefix: kind === 'export' ? 'openchamber-theme-studio' : 'theme-studio', name: label, selected });
      for (const entry of entries) {
        try {
          const raw = encodeTheme(themes[entry.variant], { ...project, name: label }, { id: entry.id, name: label, rev: 1, writer });
          if (kind === 'export' && (await host.stat(directory)).kind !== 'directory') throw problem('NO_DOWNLOAD_DIRECTORY', 'Download directory is no longer present');
          if ((await host.stat(entry.path)).kind !== 'missing') throw problem('CONFLICT', 'Filename appeared before write');
          await lease.verify();
          try { await host.writeFile(entry.path, raw); }
          catch (error) { if (await readPath(host, entry.path).catch(() => null) !== raw) throw error; }
          if (await readPath(host, entry.path) !== raw) throw problem('CONFLICT', 'Written file was changed by another editor');
          files.push(entry);
        } catch (error) { errors.push({ variant: entry.variant, code: errorCode(error), message: errorText(error) }); }
      }
    } catch (error) { errors.push({ code: errorCode(error), message: errorText(error) }); }
    finally { await lease?.release().catch(() => {}); }
    return resultFor(files, errors);
  }
  return {
    scan,
    removeSaved: (stem, records) => serial(() => setRemoved(stem, records, true)),
    undoRemoveSaved: (stem) => serial(() => setRemoved(stem, [], false)),
    checkSavedFiles,
    save: (options) => serial(() => write('save', options)),
    export: (options) => serial(() => write('export', options)),
    json(variant, project, definition) {
      const id = `theme-studio-${safeSlug(project.name)}-${variant}`;
      return encodeTheme(definition, project, { id, name: project.name, rev: 1, writer });
    },
    async copyText(text) {
      if (typeof text !== 'string' || text.length > 32_000) throw problem('CLIPBOARD_LIMIT', 'Copy is limited to 32,000 characters; export instead');
      await host.writeClipboard(text);
      return true;
    },
  };
}

export function savedCards(records) {
  const entries = new Map();
  for (const { id, name, variant, path, definition, project } of records) {
    const stem = stemOf(id);
    if (!entries.has(stem)) entries.set(stem, { id: stem, name, ids: [], variants: {}, projectId: project.id });
    const card = entries.get(stem);
    card.ids.push(id);
    card.variants[variant] = { id, name, path, swatches: {
      canvas: definition.colors.surface.background, elevated: definition.colors.surface.elevated,
      primary: definition.colors.primary.base, sidebar: definition.colors.surface.muted,
    } };
  }
  return [...entries.values()];
}
