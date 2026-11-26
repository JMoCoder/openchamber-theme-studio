import { builtins, builtinCandidates, loadBuiltinDefinitions, presetDefinitions, presets } from '../data/index.mjs';
import defaults from '../data/builtin-defaults.json' with { type: 'json' };
import { createHistory } from './history.mjs';
import {
  comparableVariant, fields, matchingOf, mergeVariant, newProject, normalizeProject, otherVariant,
  patchTune, resolveProject, safeColor, styleOf, titleOf, uid, variants,
} from './project.mjs';
import { deriveTheme, extractSeeds, previewTheme, randomTheme, repairTheme, toVariant } from './engine.mjs';
import { createLibrary, fsUnavailable, inspectImportText, savedCards } from '../host/library.mjs';
import { createLive } from '../host/live.mjs';
import { createPersistence } from '../host/persistence.mjs';

const timersDefault = { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id) };
const reduceVariants = (fn) => Object.fromEntries(variants.map((v) => [v, fn(v)]));
const nextLocale = (value) => /^zh(?:[-_]|$)/iu.test(value ?? '') ? 'zh' : 'en';
const validMode = (value) => variants.includes(value);
const defaultProject = () => newProject({ base: defaults, name: 'OpenChamber', kind: 'default', ref: 'default' });
const controls = new Set(['onboardingDismissed', 'previewCollapsed', 'borrowNoticeSeen']);
function freeze(object) {
  if (!object || typeof object !== 'object' || Object.isFrozen(object)) return object;
  for (const value of Object.values(object)) freeze(value);
  return Object.freeze(object);
}
const presetProject = (slug, locale) => {
  const entry = presets.find((card) => card.slug === slug);
  if (!entry) return null;
  const style = entry.style;
  return newProject({
    base: presetDefinitions[slug], name: entry.name[locale] ?? entry.name.en, kind: 'preset', ref: slug,
    matching: { uiFont: style?.fonts?.sans?.[0], monoFont: style?.fonts?.mono?.[0] },
  });
};
const errorNotices = {
  NOT_BUILTIN: 'tryOnUnavailable', CONFLICT: 'conflictNote', NOT_GRANTED: 'offlineNote',
  HOST_UNAVAILABLE: 'hostUnavailableNote', NOT_SUPPORTED: 'hostUnavailableNote', UNKNOWN_TYPE: 'hostUnavailableNote',
  NO_THEME_DIRECTORY: 'missingDirectoryNote', NO_DOWNLOAD_DIRECTORY: 'workspaceNoDownloads',
  CLIPBOARD_LIMIT: 'workspaceClipboardLimit', MODE_CHANGED: 'applyTargetChanged',
  EDITOR_ORIGIN_UNVERIFIED: 'workspaceDraftStorage', PREVIEW_BACKUP_MISSING: 'stateBackupMissing',
};
const fileNotices = { read: 'filesReadNote', prepare: 'prepareNote', verify: 'verifyNote' };
const needsRead = (lane) => ['checking', 'read-error', 'unavailable'].includes(lane.connection);

export function createStudio({
  host, now = Date.now, timers = timersDefault, timing = {},
  loadBuiltins = loadBuiltinDefinitions,
} = {}) {
  if (!host) throw new TypeError('createStudio requires a HostAdapter');
  const history = createHistory({ now });
  const writer = uid();
  const persistence = createPersistence(host.storage);
  const library = createLibrary({ host, writer, now, timers, settle: timing.settle });
  const subscribers = new Set();
  const cache = {};
  let project = defaultProject(), baseline = reduceVariants(() => project);
  let editVariant = 'light', hostMode = 'light', locale = 'en', tokens = {}, phase = 'booting', context = null;
  let records = [], notice = null, seq = 0, preferences = {}, enabled = true, dragging = false, touched = 0, draftId = null;
  let stopped = false, initialized = false, starting, unsubscribe, bootTimer, finishBoot;
  let snapshot, selecting = null, restoring, modeEpoch = 0, dragEpoch = 0;
  let origin = { project, variant: editVariant }, originRead = false, originWrite;
  const pending = new Set();

  function preview(v) {
    const input = [project.base[v], project.style[v], project.tune[v], project.overrides[v]];
    let entry = cache[v];
    if (entry && (dragging && v !== editVariant || input.every((value, i) => entry.input[i] === value))) return entry;
    const resolved = resolveProject(project, v, { compact: false });
    entry = { input, resolved, ...previewTheme(resolved) };
    cache[v] = entry;
    return entry;
  }
  const draft = (v) => ({ project, theme: resolveProject(project, v, { compact: false }) });
  const builtinCard = (id) => builtins.find((entry) => entry.id === id || entry.ids.includes(id));
  async function builtinProject(card) {
    const definitions = card.id === 'openchamber' ? null : await loadBuiltins();
    const base = definitions ? reduceVariants((v) => definitions[card.variants[v].id]) : defaults;
    return newProject({ base, name: card.name, kind: 'builtin', ref: card.id });
  }
  const live = createLive({
    host, writer, now, timers, getDraft: draft, getSaved: () => records, builtins: builtinCandidates,
    persistence, ensureOrigin, notify: emit, ...timing,
    async getBuiltin(id) {
      const fallback = variants.find((v) => defaults[v].metadata.id === id);
      if (fallback) return defaults[fallback];
      try { return (await loadBuiltins())[id]; } catch { return null; }
    },
    getNeutral(v) { return { project: defaultProject(), theme: defaults[v] }; },
  });
  function banner() {
    const recovering = [editVariant, otherVariant(editVariant)].filter((v) => live.lane(v).recovering);
    const trial = recovering.find((v) => live.lane(v).borrowed?.applied === false);
    if (trial) return { kind: 'tryon-left', variant: trial };
    const diff = recovering.find((v) => {
      const record = live.record(v);
      return record && comparableVariant(record.project, v) !== comparableVariant(baseline[v], v);
    });
    return diff ? { kind: 'unapplied-preview', variant: diff } : null;
  }
  function makeState() {
    const info = reduceVariants((v) => live.lane(v));
    const matching = matchingOf({ uiFont: tokens.font, monoFont: tokens.mono, fontSize: tokens.fontSize });
    const data = reduceVariants(preview);
    return freeze({
      phase, locale, variant: editVariant, project,
      host: { mode: hostMode, tokens, active: reduceVariants((v) => info[v].active),
        ...(Object.keys(matching).length ? { matching } : {}) },
      resolved: reduceVariants((v) => data[v].resolved), parsed: reduceVariants((v) => data[v].parsed),
      cssVars: reduceVariants((v) => data[v].cssVars), audit: reduceVariants((v) => data[v].audit),
      dirty: reduceVariants((v) => comparableVariant(project, v) !== comparableVariant(baseline[v], v)),
      history: history.state(),
      live: { ...info, enabled, restoring: Boolean(restoring), banner: banner() },
      library: { presets, builtins, saved: savedCards(records.filter((item) => !item.removed)),
        removed: savedCards(records.filter((item) => item.removed)) },
      notice, uiPreferences: preferences,
    });
  }
  function emit() {
    if (stopped) return;
    snapshot = makeState();
    for (const listener of subscribers) listener(snapshot);
  }
  function inform(textKey, tone = 'warning', params = {}) {
    notice = { id: ++seq, textKey, tone, params };
    emit();
  }
  function storeError() { if (!stopped) inform('workspaceDraftStorage'); }
  function persist(name, value) {
    if (!context) return Promise.resolve(false);
    return persistence.set(name, value).then(() => true, () => { storeError(); return false; });
  }
  function ensureOrigin() {
    if (!originRead) return Promise.reject(Object.assign(new Error('The editor starting point could not be read'),
      { code: 'EDITOR_ORIGIN_UNVERIFIED' }));
    originWrite ??= persistence.set('editor-origin', origin).catch((error) => {
      originWrite = undefined;
      throw error;
    });
    return originWrite;
  }
  async function readEditorOrigin() {
    const name = 'editor-origin';
    const original = await persistence.get(name).catch((error) => {
      if (error.code !== 'HOST_TIMEOUT') throw error;
      return persistence.get(name);
    });
    if (original == null) return {};
    if (!validMode(original.variant)) throw new Error('Invalid editor starting variant');
    return { original: { project: normalizeProject(original.project), variant: original.variant } };
  }
  function acceptEditorOrigin(recovered) {
    if (recovered?.original) {
      origin = recovered.original;
      originWrite = Promise.resolve();
    }
    originRead = Boolean(recovered);
  }
  function flushDraft() {
    if (draftId !== null) timers.clearTimeout(draftId);
    draftId = null;
    const saved = persist('draft', { project, editVariant, enabled, preferences });
    if (context && originRead && touched) {
      return Promise.all([saved, ensureOrigin().then(() => true, () => { storeError(); return false; })])
        .then((results) => results.every(Boolean));
    }
    return saved;
  }
  function persistDraft() {
    if (draftId !== null) timers.clearTimeout(draftId);
    draftId = timers.setTimeout(() => { void flushDraft(); }, timing.draftDebounce ?? 180);
  }
  const flushBaseline = (v) => persist(`applied-${v}`, baseline[v]);
  const recordNotice = (report) => {
    if (!report?.ok && !['CLOSED', 'HIDDEN', 'FILES_UNVERIFIED', 'NO_RETRY'].includes(report?.code)) {
      inform(errorNotices[report?.code] ?? fileNotices[report?.stage] ?? 'errorNote', 'warning', { variant: editVariant });
    }
    return report?.ok && report.record ? { ...report, name: report.record.name } : report;
  };
  let libraryGeneration = 0;
  async function refreshLibrary() {
    const generation = ++libraryGeneration;
    try {
      const found = await library.scan();
      if (!stopped && generation === libraryGeneration) { records = found; live.refreshCandidates(); }
    } catch (e) {
      if (!stopped && generation === libraryGeneration && !fsUnavailable(e) && e.code !== 'NOT_FOUND') inform('workspaceLibraryRead');
    }
  }
  async function changeSavedVisibility(id, removed) {
    const original = records;
    const report = removed ? await library.removeSaved(id, original) : await library.undoRemoveSaved(id);
    if (report.ok && !stopped) {
      // Reflect a successful preference change even if an independent directory
      // refresh arrives late. Never drop the file from host identity matching.
      const editions = new Set(original.filter((r) => r.id === `${id}-${r.variant}`).map((r) => r.edition));
      ++libraryGeneration;
      records = records.map((r) => r.id === `${id}-${r.variant}` && (!removed || editions.has(r.edition)) ? { ...r, removed } : r);
      live.refreshCandidates();
      await refreshLibrary();
    }
    return report;
  }
  async function initialize() {
    const version = touched;
    const read = (key) => persistence.get(key).catch(() => undefined);
    const [saved, light, dark, original] = await Promise.all([
      read('draft'), read('applied-light'), read('applied-dark'),
      readEditorOrigin().catch(() => null), live.start(),
    ]);
    if (stopped) return;
    const scanned = refreshLibrary();
    const atomic = (v) => {
      const record = live.record(v);
      return record?.borrowedApplied && record.borrowBaseline === `${record.writer}/${record.rev}` ? record.project : null;
    };
    if (version === touched && touched === 0) {
      let initial;
      try {
        if (saved?.project) initial = normalizeProject(saved.project);
        else {
          if (live.lane(hostMode).active?.kind === 'unknown') await scanned;
          const selected = live.lane(hostMode).active;
          const selection = live.selection();
          const card = selected?.kind === 'builtin' && builtinCard(selected.id);
          if (card && card.id !== 'openchamber') initial = await builtinProject(card);
          else if (selected?.kind === 'slot' || selected?.kind === 'tryon') initial = live.record(hostMode)?.project;
          else if (selected?.kind === 'saved') {
            const record = records.find((item) => item.variant === hostMode && item.id === selected.id);
            if (record) initial = { ...record.project, origin: { kind: 'saved', ref: selected.id } };
          }
          if (selection !== live.selection()) initial = undefined;
        }
      } catch { storeError(); }
      if (stopped) return;
      if (version === touched) {
        project = initial ?? defaultProject();
        editVariant = validMode(saved?.editVariant) ? saved.editVariant : hostMode;
        enabled = saved?.enabled !== false;
        preferences = Object.fromEntries(Object.entries(saved?.preferences ?? {}).filter(([k, value]) => controls.has(k) && typeof value === 'boolean'));
        origin = { project, variant: editVariant };
        // Uninstall removed the editor draft and its journal. The visible
        // preview still opens as a draft; Restore can recover an editor
        // starting palette from a verified original, not the lost draft.
        if (original && !original.original) {
          const v = hostMode, selection = live.selection(), start = live.previewStart(v);
          const card = start?.builtin && builtinCard(start.builtin);
          const initial = start?.project ?? (card?.id === 'openchamber' ? defaultProject() :
            card ? await builtinProject(card).catch(() => null) : null);
          if (stopped) return;
          if (initial && selection === live.selection()) origin = { project: initial, variant: v };
        }
      }
    }
    acceptEditorOrigin(original);
    if (!originRead) storeError();
    if (touched) {
      persistDraft();
    }
    const fallback = (v) => live.record(v)?.project ?? project;
    for (const [v, savedProject] of [['light', light], ['dark', dark]]) {
      try {
        baseline[v] = atomic(v) ?? (savedProject ? normalizeProject(savedProject) : fallback(v));
      }
      catch { baseline[v] = fallback(v); storeError(); }
    }
    live.setEnabled(enabled);
    phase = variants.every((v) => needsRead(live.lane(v))) ? 'degraded' : 'ready';
    emit();
  }
  function onReady(next) {
    if (stopped || !validMode(next?.theme?.mode)) return;
    const first = !context;
    context = next;
    locale = nextLocale(next.locale);
    if (hostMode !== next.theme.mode) modeEpoch++;
    hostMode = next.theme.mode;
    tokens = next.theme.tokens ?? {};
    live.setReady(next.theme);
    if (first && !initialized) {
      initialized = true;
      if (bootTimer) timers.clearTimeout(bootTimer);
      void initialize().finally(() => finishBoot?.());
    }
  }
  function start() {
    if (starting) return starting;
    starting = new Promise((resolve) => {
      finishBoot = resolve;
      bootTimer = timers.setTimeout(() => {
        if (!context && !stopped) { phase = 'degraded'; emit(); }
        resolve();
      }, timing.bootTimeout ?? 3300);
      try { unsubscribe = host.onReady(onReady); }
      catch { phase = 'degraded'; emit(); resolve(); }
    });
    return starting;
  }
  function replace(next, { key, label, phase: gesture, affected = variants, previewOnly = false, repick = false } = {}) {
    if (stopped) return;
    const changed = JSON.stringify(next) !== JSON.stringify(project);
    if (gesture === 'drag' && !dragging) dragEpoch = modeEpoch;
    const sameGestureMode = !gesture || !dragging || dragEpoch === modeEpoch;
    dragging = gesture === 'drag';
    history.record(project, changed ? next : project, { key, label, phase: gesture });
    if (changed || repick) touched++;
    if (changed) {
      project = next;
      persistDraft();
    }
    if ((changed || repick) && phase !== 'booting' && !restoring && !selecting && !previewOnly &&
        sameGestureMode && affected.includes(editVariant)) {
      live.schedule(editVariant, locale);
    }
    emit();
  }
  function interruptSource() {
    selecting = null;
  }
  function beginSource() {
    const request = { target: live.sourceTarget() };
    live.cancelScheduled();
    return selecting = request;
  }
  function move(direction) {
    interruptSource();
    const next = history[direction](project);
    if (next === project) return;
    dragging = false;
    touched++;
    project = next;
    persistDraft();
    if (phase !== 'booting' && !restoring) live.schedule(editVariant, locale);
    emit();
  }
  function swapBase(replacement, label, { resetStyle = false, styleBefore = project.style, previewOnly = false } = {}) {
    if (!replacement) return false;
    const style = resetStyle ? reduceVariants((v) => project.style[v] === styleBefore[v] ? replacement.style[v] : project.style[v]) : project.style;
    const sameSource = project.origin.kind === replacement.origin.kind && project.origin.ref === replacement.origin.ref;
    replace({ ...replacement, id: sameSource ? project.id : replacement.id, style,
      tune: project.tune, overrides: project.overrides, linked: project.linked }, { label, previewOnly, repick: true });
    return true;
  }
  function patchLayer(layer, fn, key, opts = {}, link = false) {
    const selected = link && project.linked ? variants : [editVariant];
    const next = { ...project[layer] };
    for (const v of selected) next[v] = fn(project[layer][v]);
    replace({ ...project, [layer]: next }, { repick: opts.phase !== 'drag', ...opts,
      key: `${layer}:${editVariant}:${key}`, label: key, affected: selected });
  }
  async function mutation(fn, v, apply = false) {
    if (!validMode(v) || pending.has(v)) return { ok: false, code: 'BUSY' };
    pending.add(v);
    try {
      const result = await fn();
      if (result?.ok) {
        if (phase === 'degraded' && context) { phase = 'ready'; emit(); }
        if ((apply || result.commitBaseline) && result.record) {
          baseline[v] = result.record.project;
          live.dismiss(v);
          await flushBaseline(v);
        }
        await flushDraft();
      }
      return recordNotice(result);
    } finally { pending.delete(v); }
  }
  async function loadBuiltin(id) {
    const card = builtinCard(id);
    if (!card) return false;
    const request = beginSource(), styleBefore = project.style;
    try {
      const next = await builtinProject(card);
      if (request !== selecting || stopped) return false;
      selecting = null;
      return swapBase(next, 'builtin', { resetStyle: true, styleBefore,
        previewOnly: !request.target || request.target !== live.sourceTarget() });
    } catch {
      if (request === selecting && !stopped) { selecting = null; inform('workspaceLibraryRead'); }
      return false;
    }
  }
  async function loadSaved(id) {
    const request = beginSource();
    const belongs = (item) => item.id === id || item.id.replace(/-(?:light|dark)$/u, '') === id;
    let saved = records.find((item) => item.variant === editVariant && belongs(item)) ?? records.find(belongs);
    if (!saved) { await refreshLibrary(); saved = records.find(belongs); }
    if (request !== selecting || stopped) return false;
    selecting = null;
    if (!saved) return false;
    replace({ ...saved.project, origin: { kind: 'saved', ref: id } }, { label: 'saved', repick: true,
      previewOnly: !request.target || request.target !== live.sourceTarget() });
    return true;
  }
  function loadCurrent() {
    const selected = live.lane(hostMode).active;
    if (selected?.kind === 'builtin') return loadBuiltin(selected.id);
    if (selected?.kind === 'saved') return loadSaved(selected.id);
    if (selected?.kind === 'tryon' || selected?.kind === 'slot') {
      interruptSource();
      replace(live.record(hostMode).project, { label: 'current', repick: true });
      return true;
    }
    return false;
  }
  async function loadDefault() {
    if (stopped) return { ok: false, code: 'CLOSED' };
    interruptSource();
    const next = defaultProject();
    replace({ ...next, linked: project.linked, ...(project.origin.kind === 'default' ? { id: project.id } : {}) },
      { label: 'default', repick: true });
    return { ok: true };
  }
  function restoreOriginal() {
    if (stopped) return Promise.resolve({ ok: false, code: 'CLOSED' });
    if (restoring) return restoring;
    if (phase === 'booting') return Promise.resolve({ ok: false, code: 'FILES_UNVERIFIED' });
    interruptSource();
    live.cancelScheduled();
    const start = originRead ? origin : null;
    const editorChanged = Boolean(start && (project !== start.project || editVariant !== start.variant));
    const work = variants.map((v) => {
      const record = live.record(v);
      const legacy = live.lane(v).recovering && record && comparableVariant(record.project, v) !== comparableVariant(baseline[v], v)
        ? { project: baseline[v], theme: resolveProject(baseline[v], v, { compact: false }) } : undefined;
      return live.restore(v, legacy);
    });
    restoring = Promise.all(work).then(async (reports) => {
      await flushDraft();
      const failure = reports.find((report) => !report.ok) ?? (!start ? { code: 'EDITOR_ORIGIN_UNVERIFIED' } : null);
      const result = { ok: !failure, changed: editorChanged || reports.some((report) => report.changed), editorChanged,
        observable: reports.some((report) => report.observable),
        variants: Object.fromEntries(variants.map((v, index) => [v, reports[index]])) };
      return failure ? recordNotice({ ...result, code: failure.code, stage: failure.stage }) : result;
    }).finally(() => { restoring = undefined; emit(); });
    if (start) {
      editVariant = start.variant;
      replace(start.project, { label: 'restore', previewOnly: true });
    } else emit();
    return restoring;
  }
  async function copyJson(v) {
    try { return await library.copyText(library.json(v, project, draft(v).theme)); }
    catch (error) { inform(errorNotices[error.code] ?? 'noClipboard'); return false; }
  }
  async function apply(v = editVariant) {
    if (!validMode(v)) return { ok: false, code: 'BAD_VARIANT' };
    const lane = live.lane(v);
    if (lane.connection === 'unavailable') return { ok: await copyJson(v), mode: 'copy', name: project.name };
    return mutation(() => live.applyDraft(v, { draft: draft(v), locale }), v);
  }
  async function recheck(v = editVariant) {
    if (!validMode(v)) return { ok: false, code: 'BAD_VARIANT' };
    const [result, recovered] = await Promise.all([live.recheck(v),
      !originRead && context ? readEditorOrigin().catch(() => null) : undefined]);
    if (recovered && !originRead && phase !== 'booting' && !stopped) acceptEditorOrigin(recovered);
    if (result.ok && phase === 'degraded' && context && !stopped) {
      phase = 'ready';
      emit();
      void refreshLibrary();
    }
    return recordNotice(result);
  }

  return {
    start, getState: () => snapshot ??= makeState(),
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    dispose() {
      if (stopped) return;
      if (draftId !== null) void flushDraft();
      stopped = true;
      timers.clearTimeout(bootTimer);
      unsubscribe?.();
      live.dispose();
      subscribers.clear();
      finishBoot?.();
    },
    flushDraft,
    setVariant(v) {
      if (!validMode(v) || v === editVariant) return;
      editVariant = v; dragging = false; history.split();
      if (phase !== 'booting' && !restoring) {
        if (selecting) {
          if (selecting.target || live.hasPreview()) selecting.target = live.sourceTarget();
        } else if (live.hasPreview()) live.schedule(v, locale);
      }
      persistDraft(); emit();
    },
    setLinked(on) { replace({ ...project, linked: Boolean(on) }, { label: 'linked', previewOnly: true }); },
    rename(name) {
      if (titleOf(name)) replace({ ...project, name: titleOf(name) }, { key: 'name', label: 'name', previewOnly: true });
    },
    loadPreset(slug) { interruptSource(); return swapBase(presetProject(slug, locale), 'preset', { resetStyle: true }); },
    loadBuiltin, loadSaved, loadCurrent, loadDefault, restoreOriginal,
    recoverBuiltin(v, id) { return mutation(() => live.recoverBuiltin(v, id), v); },
    loadProject(input) {
      try { interruptSource(); replace(normalizeProject(input), { label: 'project', repick: true }); return true; }
      catch { inform('importFailed'); return false; }
    },
    seedFrom(seeds = {}) {
      try {
        const kind = seeds.source === 'image' ? 'image' : 'seeds';
        const v = validMode(seeds.variant) ? seeds.variant : editVariant;
        const created = deriveTheme({ ...seeds, variant: v });
        const base = { ...project.base, [v]: created };
        if (project.linked) base[otherVariant(v)] = toVariant(created, otherVariant(v)).definition;
        interruptSource();
        replace({ ...project, base, origin: { kind } }, { label: kind, repick: true });
      } catch { inform('unknownError'); }
    },
    seedFromPixels({ data, width, height }) { return extractSeeds(data, width, height); },
    randomize(seed = uid()) {
      const base = reduceVariants((variant) => randomTheme(seed, { variant }));
      interruptSource();
      swapBase(newProject({ base, name: locale === 'zh' ? '随机灵感' : 'Random inspiration', kind: 'random', ref: String(seed) }), 'random');
    },
    setStyle(patch, opts) {
      patchLayer('style', (before) => styleOf({ ...before, ...patch, options: {
        ...(Object.hasOwn(patch, 'id') && before.id !== patch.id ? {} : before.options), ...patch.options,
      } }), Object.keys(patch).sort().join('.'), opts, true);
    },
    setTune(patch, opts) {
      const group = Object.keys(patch.groups ?? {}).sort().join('.') || patch.group || 'all';
      const names = Object.keys(patch.global ?? patch.groups?.[group] ?? patch).sort().join('.');
      patchLayer('tune', (before) => patchTune(before, patch), `${group}.${names}`, opts, true);
    },
    setOverride(path, value, opts) {
      if (!fields.has(path) || !safeColor(value)) return false;
      patchLayer('overrides', (before) => ({ ...before, [path]: value.trim() }), path, opts);
      return true;
    },
    clearOverride(path) { patchLayer('overrides', ({ [path]: _, ...rest }) => rest, path); },
    clearOverrides(group) {
      patchLayer('overrides', (before) => group
        ? Object.fromEntries(Object.entries(before).filter(([path]) => fields.get(path)?.group !== group)) : {}, 'clear-overrides');
    },
    makeCounterpart(target) {
      if (!validMode(target)) return;
      const source = otherVariant(target);
      const base = { ...project.base, [target]: toVariant(project.base[source], target).definition };
      replace({ ...project, base }, { label: 'counterpart', repick: true });
    },
    repair(v = editVariant) {
      const report = repairTheme(draft(v).theme);
      const overrides = Object.fromEntries(report.changes.filter(({ path, to }) => fields.has(path) && safeColor(to))
        .map(({ path, to }) => [path, to]));
      replace({ ...project, overrides: { ...project.overrides, [v]: { ...project.overrides[v], ...overrides } } },
        { label: 'repair', affected: [v], repick: true });
      return report;
    },
    setMatching(patch) { replace({ ...project, matching: matchingOf({ ...project.matching, ...patch }) }, { label: 'matching', previewOnly: true }); },
    undo: () => move('undo'), redo: () => move('redo'),
    setLive(on) { enabled = Boolean(on); live.setEnabled(enabled); persistDraft(); emit(); },
    tryOn(v = editVariant) { return mutation(() => live.tryOn(v, locale), v); },
    endTryOn(v = editVariant) { return mutation(() => live.endTryOn(v), v); },
    prepareSlot(v = editVariant) { return mutation(() => live.prepareSlot(v, { locale, mode: 'slot', commitBaseline: true }), v); },
    apply, recheck,
    retry(v = editVariant) {
      if (!validMode(v)) return { ok: false, code: 'BAD_VARIANT' };
      return needsRead(live.lane(v)) || live.isPreviewRetry(v) ? recheck(v) : mutation(() => live.retry(v, locale), v);
    },
    async revert(v = editVariant) {
      if (banner()?.kind === 'tryon-left' && live.lane(v).recovering && live.lane(v).doingTryOn) return mutation(() => live.endTryOn(v), v);
      const saved = baseline[v];
      replace({ ...mergeVariant(project, saved, v), name: saved.name, matching: saved.matching }, { label: 'revert', affected: [], previewOnly: true });
      if (!live.lane(v).exists && !live.lane(v).doingTryOn) return { ok: true, changed: false };
      return mutation(() => live.apply(v, { draft: draft(v), locale, commitBaseline: true }), v);
    },
    async resolveConflict(v, choice) {
      if (!['load', 'overwrite'].includes(choice)) return { ok: false, code: 'BAD_ACTION' };
      const result = await mutation(() => live.resolve(v, choice, locale), v, choice === 'overwrite');
      if (result?.ok && choice === 'load' && result.record) {
        baseline[v] = result.record.project;
        replace(result.record.project, { label: 'conflict', previewOnly: true });
        await flushBaseline(v);
      }
      return result;
    },
    async keepPreview() {
      const v = banner()?.variant ?? editVariant;
      const loaded = live.record(v)?.project;
      if (!loaded) return false;
      if (live.lane(v).borrowed) {
        const accepted = await mutation(() => live.keep(v, locale), v);
        if (!accepted.ok) return false;
      }
      baseline[v] = loaded;
      replace(loaded, { label: 'keep', previewOnly: true });
      live.dismiss(v);
      await Promise.all([flushBaseline(v), flushDraft()]);
      return true;
    },
    async saveAs({ name, variants: requested } = {}) {
      const report = await library.save({ name, requested, project, locale, themes: reduceVariants((v) => draft(v).theme) });
      if (report.files.length) await refreshLibrary();
      return recordNotice(report);
    },
    removeSaved: (id) => changeSavedVisibility(id, true),
    undoRemoveSaved: (id) => changeSavedVisibility(id, false),
    async checkSavedFiles(card) {
      const report = await library.checkSavedFiles(card);
      if (report.ok && !stopped) await refreshLibrary();
      return report;
    },
    async exportFiles({ variants: requested } = {}) {
      return recordNotice(await library.export({ requested, project, locale, themes: reduceVariants((v) => draft(v).theme) }));
    },
    copyJson(v = editVariant) { return copyJson(v); },
    getJson(v = editVariant) { return library.json(v, project, draft(v).theme); },
    async copyText(text) {
      try { return await library.copyText(text); }
      catch (error) { inform(errorNotices[error.code] ?? 'noClipboard'); return false; }
    },
    importText(text, filename) {
      const report = inspectImportText(text, filename);
      if (report.ok) {
        interruptSource();
        editVariant = report.variant;
        replace(report.project, { label: 'import', repick: true });
      }
      return report;
    },
    setUiPreferences(patch) {
      for (const [key, value] of Object.entries(patch)) if (controls.has(key) && typeof value === 'boolean') preferences = { ...preferences, [key]: value };
      persistDraft(); emit();
    },
  };
}
