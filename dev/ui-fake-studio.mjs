import { inspectThemeImport, parseTheme, themeToCssVariables } from '../shared/theme-core.mjs';
import { adjustTheme, auditTheme, deriveTheme, extractSeeds, randomTheme, repairTheme, toVariant } from '../shared/theme-derive.mjs';
import { applyStyleRecipe } from '../shared/style-recipes.mjs';
import { language } from '../src/ui/model.mjs';

const variants = ['light', 'dark'];
const other = (variant) => variant === 'light' ? 'dark' : 'light';
const clone = (value) => structuredClone(value);
const pair = (fn) => ({ light: fn('light'), dark: fn('dark') });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const withValue = (theme, path, value) => {
  let entry = theme;
  const parts = path.split('.');
  for (const key of parts.slice(0, -1)) entry = (entry[key] ??= {});
  entry[parts.at(-1)] = value;
};

function baseFor(project, variant) {
  let output = project.base[variant];
  const style = project.style[variant];
  if (style.id) output = applyStyleRecipe(style.id, output, { ...style.options, strength: style.strength }).definition;
  const { global, groups, protectStatus, protectSyntax } = project.tune[variant];
  if (global) output = adjustTheme(output, { ...global, protectStatus, protectSyntax }).definition;
  for (const [group, settings] of Object.entries(groups ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    output = adjustTheme(output, { ...settings, group, protectStatus, protectSyntax }).definition;
  }
  return output;
}

function resolve(project, variant) {
  const base = baseFor(project, variant);
  const replacements = Object.entries(project.overrides[variant]);
  if (!replacements.length) return base;
  const output = clone(base);
  for (const [path, value] of replacements) withValue(output, path, value);
  return output;
}

function toHost(definition) {
  const v = themeToCssVariables(parseTheme(definition));
  return {
    background: v['--background'], elevated: v['--card'], foreground: v['--foreground'], muted: v['--muted-foreground'],
    subtle: v['--surface-subtle'], border: v['--border'], focus: v['--interactive-focus'], primary: v['--primary'],
    primaryForeground: v['--primary-foreground'], elevatedForeground: v['--card-foreground'], warning: v['--status-warning'],
    error: v['--status-error'], info: v['--status-info'], success: v['--status-success'],
    font: 'system-ui, sans-serif', mono: 'monospace', radius: '0.5625rem', fontSize: '16px',
  };
}

/** Fixture only: same Studio methods and observable states, never writes host files. */
export function createFakeStudio(fixtures, { locale = 'en', mode = 'light', variant = mode, scenario = 'off' } = {}) {
  const subscribers = new Set();
  const past = [], future = [];
  let dragBackup, noticeId = 0, updateTimer, clipboard = '', fixture = scenario, savedOrder = 0;
  const deletedPaths = new Set();
  const otherBuiltin = fixtures.builtins.find((b) => b.id === 'flexoki') ?? fixtures.builtins[0];
  const adopted = (v) => ({
    kind: 'builtin', id: otherBuiltin?.themes[v]?.metadata.id ?? 'flexoki-' + v,
    name: otherBuiltin?.themes[v]?.metadata.name ?? `Flexoki ${v}`,
  });
  function newProject(card, kind = 'preset') {
    return { schemaVersion: 1, id: card.slug ?? card.id, name: typeof card.name === 'string' ? card.name : card.name[language(locale)] ?? card.name.en,
      origin: { kind, ref: card.slug ?? card.id }, base: card.themes, linked: true, matching: {},
      style: pair(() => ({ id: null, strength: 1, options: {} })), tune: pair(() => ({ global: {}, groups: {} })), overrides: pair(() => ({})) };
  }
  const native = fixtures.builtins.find((b) => b.id === 'openchamber') ?? fixtures.presets[0];
  const defaultProject = () => ({ ...newProject(native, 'default'), name: 'OpenChamber', origin: { kind: 'default', ref: 'default' } });
  const initial = defaultProject();
  let hostStart;
  let state = {
    phase: 'booting', locale, variant, host: {
      mode, tokens: toHost(otherBuiltin?.themes[mode] ?? initial.base[mode]), active: pair(adopted),
      matching: { uiFont: 'system', monoFont: 'system-mono' },
    },
    project: initial, resolved: {}, parsed: {}, cssVars: {}, audit: {}, dirty: pair(() => false),
    history: { canUndo: false, canRedo: false },
    live: { enabled: true, banner: null, ...pair((v) => ({ connection: v === mode ? 'off' : 'hidden', sync: 'idle', canTryOn: v === mode, borrowed: null })) },
    library: { presets: fixtures.presets, builtins: fixtures.builtins, saved: [], removed: [] },
    uiPreferences: {}, notice: null,
  };

  function update(patch, { emit = true, recalc = false, drag = false } = {}) {
    state = { ...state, ...patch, history: { canUndo: Boolean(past.length || dragBackup), canRedo: !!future.length } };
    if (recalc) {
      const modes = drag ? [state.variant] : variants;
      for (const v of modes) {
        const output = resolve(state.project, v);
        const parsed = parseTheme(output);
        const vars = themeToCssVariables(parsed);
        state = { ...state, resolved: { ...state.resolved, [v]: output }, parsed: { ...state.parsed, [v]: parsed }, cssVars: { ...state.cssVars, [v]: vars },
          dirty: { ...state.dirty, [v]: !equal(output, initial.base[v]) || state.project.name !== initial.name } };
        if (!drag) state.audit = { ...state.audit, [v]: auditTheme(output) };
      }
    }
    if (emit) for (const fn of subscribers) fn(state);
  }

  function edit(fn, opts = {}) {
    const prev = state.project, next = fn(clone(prev));
    if (opts.phase === 'drag') dragBackup ??= prev;
    else {
      const latest = dragBackup ?? prev;
      if (!equal(latest, next)) { past.push(latest); future.length = 0; }
      dragBackup = undefined;
    }
    update({ project: next }, { recalc: true, drag: opts.phase === 'drag' });
    if (!opts.previewOnly) preview();
    return next;
  }

  function liveState(v, item = {}, extra = {}) {
    update({ live: { ...state.live, ...extra, [v]: { ...state.live[v], ...item } } });
  }

  function setScenario(next) {
    clearTimeout(updateTimer);
    fixture = next;
    const v = state.variant;
    const borrowedScenario = ['tryon', 'tryon-left', 'borrow-applied', 'borrow-inactive', 'borrow-unknown'].includes(next);
    const behavior = borrowedScenario ? 'tryon' : next === 'applied' ? 'active' : ['ambiguous', 'custom'].includes(next) ? 'idle'
      : ['unavailable', 'read-error', 'verify-error', 'off', 'idle', 'tryon', 'active', 'hidden', 'conflict', 'error'].includes(next) ? next : 'off';
    const mode = next === 'hidden' ? other(v) : state.host.mode;
    const active = pair(adopted);
    const borrowed = !borrowedScenario ? null : { id: active[v].id, name: active[v].name, applied: next.startsWith('borrow-'),
      inUse: next === 'borrow-inactive' ? false : next === 'borrow-unknown' ? null : true };
    if (borrowed?.inUse === true) active[v] = { kind: 'tryon', id: borrowed.id, name: borrowed.name };
    if (next === 'borrow-inactive') active[v] = { kind: 'saved', id: 'fixture-custom', name: 'Local theme' };
    if (next === 'borrow-unknown') active[v] = { kind: 'unknown', reason: 'ambiguous' };
    if (next === 'idle' || next === 'custom') active[v] = { kind: 'custom', id: 'my-local-theme', name: 'Local theme' };
    if (next === 'ambiguous') active[v] = { kind: 'unknown', reason: 'ambiguous', name: '' };
    if (behavior === 'active') active[v] = { kind: 'slot', id: `theme-studio-live-${v}`, name: `Theme Studio · ${state.project.name}` };
    const tokens = next === 'extreme' ? { background: '#ff09fa', foreground: '#ff09fa', elevated: '#000', muted: '#ff09fa', primary: '#808080', primaryForeground: '#808080', border: '#ff09fa', focus: '#ff09fa', font: 'none', radius: '500px' }
      : toHost(borrowed?.inUse === true || behavior === 'active' ? state.resolved[mode] ?? initial.base[mode] : otherBuiltin?.themes[mode] ?? initial.base[mode]);
    update({
      phase: next === 'booting' ? 'booting' : next === 'unavailable' ? 'degraded' : 'ready',
      ...(next === 'extreme' ? { project: { ...state.project,
        overrides: { ...state.project.overrides, [v]: { ...state.project.overrides[v], 'colors.surface.background': '#ff09fa', 'colors.surface.foreground': '#ff09fa' } } } } : {}),
      host: { ...state.host, active, tokens, mode },
      live: { enabled: next !== 'paused', ...pair((v) => ({ connection: next === 'unavailable' ? 'unavailable' : v === mode ? 'off' : 'hidden',
        sync: 'idle', canTryOn: next !== 'unavailable' && v === mode, borrowed: null })),
         [v]: { connection: behavior, sync: ['writing', 'waiting', 'applied', 'timeout'].includes(next) ? next : 'idle', canRecheck: true,
           canTryOn: ['off', 'idle'].includes(behavior) && v === mode && active[v]?.kind === 'builtin', borrowed,
           reason: next === 'error' ? 'EACCES' : undefined, exists: ['active', 'idle', 'tryon'].includes(behavior) },
      },
    }, { recalc: true });
  }

  function sync(v, connection, patch = {}, complete) {
    clearTimeout(updateTimer);
    if (state.live[v].connection === 'unavailable') return false;
    if (state.live[v].connection === 'conflict') return false;
    liveState(v, { connection, sync: 'writing', ...patch });
    updateTimer = setTimeout(() => {
      liveState(v, { sync: 'waiting' });
      updateTimer = setTimeout(() => {
        const visible = v === state.host.mode && ['active', 'tryon'].includes(connection) && patch.borrowed?.inUse !== false;
        liveState(v, { sync: visible ? 'applied' : 'idle' });
        if (visible) update({ host: { ...state.host, tokens: toHost(state.resolved[v]) } });
        complete?.(visible);
      }, 125);
    }, 45);
    return true;
  }

  const loadCard = (card, kind) => {
    if (!card) return false;
    edit((p) => ({ ...newProject(card, kind), linked: p.linked, tune: p.tune, overrides: p.overrides }));
    return true;
  };
  function startBorrow(v) {
    const current = state.host.active[v];
    const borrowed = { id: current.id, name: current.name, inUse: null };
    return sync(v, 'tryon', { borrowed, canTryOn: false, exists: true }, (visible) => {
      liveState(v, { borrowed: { ...state.live[v].borrowed, inUse: visible ? true : null } });
      if (visible) update({ host: { ...state.host, active: { ...state.host.active, [v]: { ...current, kind: 'tryon' } } } });
    });
  }
  function preview() {
    const v = state.variant, lane = state.live[v];
    if (!state.live.enabled || state.host.mode !== v || state.phase !== 'ready') return;
    if (lane.canTryOn) startBorrow(v);
    else if (lane.connection === 'active' || lane.connection === 'tryon' && lane.borrowed?.inUse !== false) {
      sync(v, lane.connection, { borrowed: lane.borrowed });
    }
  }
  function setHostMode(v) {
    if (!variants.includes(v) || state.host.mode === v) return;
    clearTimeout(updateTimer);
    const before = state.host.mode, lane = state.live[v], a = state.host.active[v];
    const selected = lane.borrowed && a?.kind === 'tryon';
    update({ host: { ...state.host, mode: v, tokens: toHost(selected || a?.kind === 'slot'
      ? state.resolved[v] : otherBuiltin?.themes[v] ?? initial.base[v]) },
    live: { ...state.live,
      [before]: { ...state.live[before], connection: 'hidden', canTryOn: false,
        borrowed: state.live[before].borrowed ? { ...state.live[before].borrowed, inUse: null } : null },
      [v]: { ...lane, connection: lane.borrowed ? 'tryon' : a?.kind === 'slot' ? 'active' : lane.exists ? 'idle' : 'off',
        canTryOn: !lane.borrowed && a?.kind === 'builtin', borrowed: lane.borrowed ? { ...lane.borrowed, inUse: Boolean(selected) } : null },
    } });
  }
  const failReport = () => ({ ok: false, paths: [] });
  const newNotice = (tone, textKey, params) => update({ notice: { id: ++noticeId, tone, textKey, params } });
  function setSavedState(id, from, to) {
    const lib = state.library, card = lib[from].find((item) => item.id === id);
    if (!card) return { ok: false };
    update({ library: { ...lib, [from]: lib[from].filter((item) => item.id !== id), [to]: [...lib[to], card] } });
    return { ok: true };
  }
  const studio = {
    getState: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    async start() { setScenario(scenario); hostStart = clone({ host: state.host, live: state.live, variant: state.variant }); },
    dispose() { clearTimeout(updateTimer); subscribers.clear(); },
    setVariant(v) { if (variants.includes(v)) update({ variant: v }, { recalc: true }); },
    setLinked(linked) { edit((p) => ({ ...p, linked }), { previewOnly: true }); },
    rename(name) { if (name.trim()) edit((p) => ({ ...p, name: name.trim() }), { previewOnly: true }); },
    loadPreset(slug) { return loadCard(state.library.presets.find((p) => p.slug === slug), 'preset'); },
    loadBuiltin(id) { return loadCard(state.library.builtins.find((p) => p.id === id || p.ids?.includes(id)), 'builtin'); },
    async loadDefault() { edit((p) => ({ ...defaultProject(), linked: p.linked })); return { ok: true }; },
    async restoreOriginal() {
      clearTimeout(updateTimer);
      const { host, live, variant } = clone(hostStart);
      update({ host, live: { ...live, enabled: state.live.enabled }, variant });
      edit(() => initial, { previewOnly: true });
      return { ok: true };
    },
    async loadSaved(id) {
      const card = state.library.saved.find((p) => p.id === id || p.ids?.includes(id));
      if (card?.project) edit(() => clone(card.project));
    },
    loadProject(p) { edit(() => clone(p)); },
    loadCurrent() { return studio.loadBuiltin(state.host.active[state.variant]?.id); },
    seedFrom(seeds) {
      const v = seeds.variant ?? state.variant;
      edit((p) => {
        p.base[v] = deriveTheme({ ...seeds, variant: v, id: p.base[v].metadata.id, name: p.name });
        if (p.linked) p.base[other(v)] = toVariant(p.base[v], other(v)).definition;
        p.origin = { kind: seeds.source === 'image' ? 'image' : 'seeds' };
        return p;
      });
    },
    seedFromPixels({ data, width, height }) { return extractSeeds(data, width, height); },
    randomize(seed = String(Math.random())) {
      edit((p) => ({ ...p, base: pair((v) => randomTheme(seed, { variant: v, id: p.base[v].metadata.id, name: p.name })), origin: { kind: 'random' } }));
    },
    setStyle(patch, opts) {
      edit((p) => {
        for (const v of p.linked ? variants : [state.variant]) p.style[v] = { ...p.style[v], ...patch,
          options: patch.id !== undefined ? patch.options ?? {} : { ...p.style[v].options, ...patch.options } };
        return p;
      }, opts);
    },
    setTune(patch, opts) {
      edit((p) => {
        for (const v of p.linked ? variants : [state.variant]) {
          const prev = p.tune[v], groups = { ...prev.groups };
          for (const [key, value] of Object.entries(patch.groups ?? {})) groups[key] = { ...groups[key], ...value };
          p.tune[v] = { ...prev, global: { ...prev.global, ...patch.global }, groups };
          for (const key of ['protectStatus', 'protectSyntax']) if (typeof patch[key] === 'boolean') p.tune[v][key] = patch[key];
        }
        return p;
      }, opts);
    },
    setOverride(path, value, opts) { edit((p) => (p.overrides[state.variant][path] = value, p), opts); },
    clearOverride(path) { edit((p) => (delete p.overrides[state.variant][path], p)); },
    clearOverrides(group) {
      edit((p) => {
        if (!group) p.overrides[state.variant] = {};
        else for (const path of Object.keys(p.overrides[state.variant])) {
          if (fixtures.fields.fields.find((f) => f.path === path)?.group === group) delete p.overrides[state.variant][path];
        }
        return p;
      });
    },
    makeCounterpart(v) { edit((p) => (p.base[v] = toVariant(p.base[other(v)], v).definition, p)); },
    repair(v) {
      const before = state.audit[v], outcome = repairTheme(state.resolved[v]);
      edit((p) => {
        for (const change of outcome.changes) {
          const path = Array.isArray(change.path) ? change.path.join('.') : change.path;
          if (path && typeof change.to === 'string') p.overrides[v][path] = change.to;
        }
        return p;
      });
      return { before, after: state.audit[v], changes: outcome.changes };
    },
    setMatching(patch) { edit((p) => ({ ...p, matching: { ...p.matching, ...patch } }), { previewOnly: true }); },
    undo() { if (past.length) { future.push(state.project); update({ project: past.pop() }, { recalc: true }); preview(); } },
    redo() { if (future.length) { past.push(state.project); update({ project: future.pop() }, { recalc: true }); preview(); } },
    setLive(enabled) {
      if (!enabled) clearTimeout(updateTimer);
      update({ live: { ...state.live, enabled } });
    },
    async resolveConflict(v) {
      liveState(v, { connection: 'active', sync: 'idle' });
      return true;
    },
    async recheck() { if (fixture === 'read-error') setScenario('off'); return { ok: true }; },
    async retry(v) { liveState(v, { connection: 'off', sync: 'idle' }); return { ok: true }; },
    async saveAs({ name, variants: modes }) {
      if (state.phase === 'degraded') return failReport();
      const id = `my-theme-${++savedOrder}`;
      const files = modes.map((v) => ({ variant: v, id: `${id}-${v}`,
        path: `~/.config/openchamber/themes/theme-studio-${id}-${v}.json` }));
      const saved = { id, name, project: { ...clone(state.project), name, origin: { kind: 'saved', ref: id } },
        ids: files.map((f) => f.id),
        variants: Object.fromEntries(files.map((f) => [f.variant, { ...f, name: `${name} (${f.variant})` }])),
        themes: Object.fromEntries(modes.map((v) => [v, state.resolved[v]])) };
      update({ library: { ...state.library, saved: [...state.library.saved, saved] } });
      return { ok: true, files };
    },
    async removeSaved(id) { return setSavedState(id, 'saved', 'removed'); },
    async undoRemoveSaved(id) { return setSavedState(id, 'removed', 'saved'); },
    async checkSavedFiles(card) {
      const paths = Object.values(card.variants ?? {}).map((item) => item.path);
      if (!paths.length || state.phase === 'degraded') return { ok: false, missing: [], remaining: [] };
      const missing = paths.filter((path) => deletedPaths.has(path)), remaining = paths.filter((path) => !deletedPaths.has(path));
      const saved = state.library.saved.flatMap((item) => {
        if (item.id !== card.id || !missing.length) return [item];
        const present = Object.fromEntries(Object.entries(item.variants).filter(([, file]) => !deletedPaths.has(file.path)));
        return Object.keys(present).length ? [{ ...item, variants: present, ids: Object.values(present).map((file) => file.id) }] : [];
      });
      update({ library: { ...state.library, saved } });
      return { ok: true, missing, remaining };
    },
    async exportFiles({ variants: modes }) {
      if (state.phase === 'degraded') return failReport();
      return { ok: true, paths: modes.map((v) => `~/Downloads/openchamber-theme-studio-fixture-${v}.json`) };
    },
    getJson(v) { return JSON.stringify(state.resolved[v], null, 2); },
    async copyJson(v) { if (fixture === 'clipboardless') return false; clipboard = studio.getJson(v); return Boolean(clipboard); },
    async copyText(text) { clipboard = String(text); return Boolean(clipboard); },
    importText(text) {
      let input;
      try { input = JSON.parse(text); } catch { return { ok: false, issues: [] }; }
      if (input?.tokenColors || input?.semanticTokenColors) return { ok: false, kind: 'vscode' };
      const report = inspectThemeImport(input);
      if (report.issues.length || !report.definition) return { ...report, ok: false };
      const v = report.definition.metadata.variant;
      edit((p) => ({ ...p, name: report.definition.metadata.name, origin: { kind: 'import' }, base: { ...p.base, [v]: report.definition } }));
      studio.setVariant(v);
      return { ...report, ok: true };
    },
    setUiPreferences(patch) { update({ uiPreferences: { ...state.uiPreferences, ...patch } }); },
    test: { setScenario, setHostMode, setLocale(value) { update({ locale: value }); }, readClipboard: () => clipboard, newNotice,
      deleteFile(path) { deletedPaths.add(path); },
      selectOtherTheme() {
        const v = state.host.mode, lane = state.live[v];
        update({ host: { ...state.host, active: { ...state.host.active, [v]: { kind: 'saved', id: 'fixture-custom', name: 'Local theme' } },
          tokens: toHost(initial.base[v]) } });
        liveState(v, lane.borrowed ? { borrowed: { ...lane.borrowed, inUse: false }, sync: 'idle' } : { canTryOn: false, connection: 'idle' });
      } },
  };
  return studio;
}
