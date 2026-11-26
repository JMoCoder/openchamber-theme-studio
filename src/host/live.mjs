import { parseTheme } from '../../shared/theme-core.mjs';
import { resolveProject, uid, variants } from '../core/project.mjs';
import { distinguishPlaceholder, identifyTheme, themeKey, tokenKey } from './identify.mjs';
import { decodeOwned, encodeTheme, errorCode, fsUnavailable, isPreviewWriter, problem, readPath, slotId, slotPath, themesDir } from './library.mjs';
import { acquireLease } from './lease.mjs';

export const THEME_CONFIRMATION_TIMEOUT_MS = 12_000;
const restoredWriter = (id) => id.replace(/^preview-/u, 'restored-').slice(0, 128);
const orphaned = (record, backup) => isPreviewWriter(record?.writer) && record.writer !== backup?.id;
const backupMissing = () => problem('PREVIEW_BACKUP_MISSING', 'The original theme backup is missing');
const deactivatesPreview = (intent) => intent === 'restore' || intent === 'recover';
const sameTree = (a, b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((key) => Object.hasOwn(b, key) && sameTree(a[key], b[key])));
function samePaint(a, b) {
  const left = parseTheme(a), right = parseTheme(b);
  return sameTree(left.colors, right.colors) && sameTree(left.config, right.config);
}

function previewDefinition(definition, v) {
  if (definition.metadata.variant === v) return definition;
  // Resolve in the source edition before switching the advertised mode:
  // otherwise the host would derive hover/active and PR colors for the sink.
  const painted = parseTheme(definition);
  return { ...painted, metadata: { ...painted.metadata, variant: v } };
}

function nativeDefinition(record, v) {
  return record.previewVariant && record.previewVariant !== v
    ? resolveProject(record.project, v, { compact: false }) : record.definition;
}

// Only idempotent filesystem reads may try the transport twice. Permission,
// path and other errors are definitive for this check. Writes are never retried here.
async function readOnceMoreOnTimeout(read) {
  try { return await read(); }
  catch (error) {
    if (error.code !== 'HOST_TIMEOUT') throw error;
    return read();
  }
}

export function createLive({
  host, writer, builtins, getDraft, getSaved, notify, persistence, ensureOrigin, getBuiltin, getNeutral,
  library, refreshSaved, updateSaved, filesUnverified, onNamedPreview,
  timers = { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id) },
  now = Date.now, debounce = 250, timeout = THEME_CONFIRMATION_TIMEOUT_MS, settle = 35,
}) {
  const lanes = Object.fromEntries(variants.map((v) => [v, {
    raw: null, record: null, known: false, readState: 'checking', readError: null, probe: null,
    sync: 'idle', preflight: false, conflict: false, seenRecovery: false, attempt: null,
    active: null, delay: null, request: null, inFlight: null, timeout: null, receipt: null, error: null,
    generation: 0, backup: null, backupRead: false, legacyRestored: false, blockedProbe: null, fallback: null, namedError: null,
  }]));
  let queue = Promise.resolve(), ready = null, observed = 0, selection = 0, sourceEpoch = 0, stopped = false, enabled = true;
  const readHost = {
    stat: (path) => readOnceMoreOnTimeout(() => host.stat(path)),
    readFile: (path) => readOnceMoreOnTimeout(() => host.readFile(path)),
  };
  const builtin = (id, v) => builtins.find((entry) => entry.id === id && entry.variant === v);
  const own = (raw, v, allowPreviewSize = true) => {
    const info = decodeOwned(raw, v, { allowPreviewSize });
    return info?.id === slotId(v) || (info && builtin(info.id, v)) ? info : null;
  };
  const trial = (record, v) => record && record.id !== slotId(v) ? builtin(record.id, v) : null;
  function recoveryKind(record, backup, v, reopened) {
    const missing = orphaned(record, backup);
    if (!record || backup || record.origin !== undefined) return missing ? 'preserve' : null;
    // 0.1 wrote unconfirmed try-ons with an ordinary writer. Do not
    // classify a confirmed borrow or an arbitrary old slot as an orphan.
    const oldTryOn = reopened && !record.borrowedApplied && !record.previewVariant &&
      /(?:（试穿）| \(trying on\))$/u.test(record.name);
    if ((missing || oldTryOn) && trial(record, v)) return 'builtin';
    return missing ? 'preserve' : null;
  }
  const publish = () => { if (!stopped) notify(); };
  const clear = (lane, key) => {
    if (lane[key] !== null) timers.clearTimeout(lane[key]);
    lane[key] = null;
  };
  const cancel = (lane) => {
    lane.generation++;
    clear(lane, 'delay');
    lane.request = null;
  };
  const resetReceipt = (lane) => {
    clear(lane, 'timeout');
    lane.receipt = null;
  };
  const current = (v) => ready?.mode === v;
  const displayed = (v) => current(v) ? tokenKey(ready.tokens) : null;
  const checkingSelection = (lane) => lane.receipt?.selectionProbe && ['writing', 'waiting', 'timeout'].includes(lane.sync);
  const writable = (active) => ['builtin', 'slot', 'tryon', 'saved'].includes(active?.kind);
  function identify() {
    if (!ready) return;
    const v = ready.mode;
    const lane = lanes[v];
    if (!lane) return;
    const candidates = [...builtins, ...getSaved().map(({ project, id, name, variant, key, preview }) =>
      ({ id, name, variant, key: preview?.key ?? key, projectId: project.id, kind: 'saved' }))];
    if (lane.record) {
      const target = trial(lane.record, v);
      const { id, name, key, project } = lane.record;
      candidates.push({ id, name, key, variant: v, kind: target ? 'tryon' : 'slot', projectId: project.id });
    }
    const matched = identifyTheme(ready, candidates);
    const incomplete = filesUnverified() || Object.values(lanes).some(({ raw, record }) => raw !== null && !record);
    lane.active = incomplete && matched.reason !== 'unmatched'
      ? { kind: 'unknown', variant: v, reason: 'unverified-files' } : matched;
  }
  function armTimeout(v, lane) {
    if (lane.timeout !== null || !lane.receipt) return;
    lane.timeout = timers.setTimeout(() => {
      lane.timeout = null;
      if (lane.receipt && (lane.sync === 'waiting' || lane.sync === 'writing')) {
        lane.sync = 'timeout';
        stopOrRedirectProbe(v, true);
        publish();
        dispatchPreview(v);
      }
    }, timeout);
  }
  function stopOrRedirectProbe(v, replay) {
    const lane = lanes[v], receipt = lane.receipt;
    if (!receipt?.pick || !receipt.selectionProbe || lane.sync !== 'timeout' || displayed(v) !== receipt.before) return;
    const { before, fallback, pick } = receipt;
    if (fallback) {
      const latest = lane.request ?? (lane.generation === pick.generation ? pick : null);
      lane.fallback = { before, target: fallback };
      if (replay && latest) schedule(latest.variant, latest.locale);
    } else lane.blockedProbe = before;
  }
  function checkReceipt(v, lane) {
    if (!lane.receipt || !current(v) || !lane.receipt.written || observed <= lane.receipt.after) return;
    const key = displayed(v);
    if (key && key === lane.receipt.key && key !== lane.receipt.before) {
      clear(lane, 'timeout');
      lane.sync = 'applied';
      lane.receipt.selectionProbe = null;
      lane.blockedProbe = null;
      lane.fallback = null;
      dispatchPreview(v);
    } else if (lane.sync === 'applied') {
      // This write already completed. A newer/different ready (e.g. selecting
      // the slot after ending a trial) is not evidence of a pending write.
      lane.sync = 'idle';
      resetReceipt(lane);
    }
  }
  function setReady(theme) {
    if (!theme || !variants.includes(theme.mode) || stopped) return;
    const before = ready?.mode;
    if (before !== theme.mode) sourceEpoch++;
    if (before !== theme.mode || tokenKey(ready?.tokens) !== tokenKey(theme.tokens)) selection++;
    ready = theme;
    observed++;
    if (before && before !== ready.mode) {
      cancel(lanes[before]);
      lanes[before].active = null; // never pass cached mode off as the current one
    }
    const lane = lanes[ready.mode], key = displayed(ready.mode);
    if (key && lane.blockedProbe && lane.blockedProbe !== key) {
      lane.blockedProbe = null;
      if (key !== lane.receipt?.key) {
        lane.sync = 'idle';
        resetReceipt(lane);
      }
    }
    if (key && lane.fallback?.before !== key) lane.fallback = null;
    identify();
    checkReceipt(ready.mode, lanes[ready.mode]);
    if (before !== ready.mode) stopOrRedirectProbe(ready.mode, false);
    publish();
  }
  function adopt(v, raw, recovery = false) {
    const lane = lanes[v];
    lane.known = true;
    lane.readState = 'ready';
    lane.readError = null;
    lane.raw = raw;
    lane.record = own(raw, v);
    const recordedProbe = lane.record?.probeBefore;
    if (recordedProbe && (!current(v) || displayed(v) === recordedProbe)) lane.blockedProbe = recordedProbe;
    lane.fallback = null;
    lane.conflict = raw !== null && !lane.record;
    lane.error = null;
    lane.attempt = null;
    lane.sync = 'idle';
    if (recovery) lane.seenRecovery = raw !== null;
    resetReceipt(lane);
    identify();
  }
  function fail(v, error, stage) {
    const lane = lanes[v];
    const code = stage === 'read' ? error.code ?? 'READ_FAILED' : errorCode(error);
    const issue = { code, message: error.message };
    if (stage === 'read') {
      lane.readState = fsUnavailable(error) || code === 'NO_THEME_DIRECTORY' ? 'unavailable' : 'read-error';
      lane.readError = issue;
      clear(lane, 'delay');
    } else if (code === 'CONFLICT') {
      lane.conflict = true;
      lane.attempt = null;
      lane.error = null;
      lane.sync = 'idle';
      resetReceipt(lane);
    } else if (!['CLOSED', 'MODE_CHANGED', 'NOT_BUILTIN', 'ALREADY_TRYING'].includes(code)) {
      // A failed retry preflight cannot erase an unresolved earlier write.
      if (stage !== 'prepare' || !lane.attempt) lane.error = { ...issue, stage };
      if (stage === 'write' || stage === 'verify') lane.sync = 'idle';
      if (stage === 'write') resetReceipt(lane);
    }
    return { ok: false, ...issue, stage };
  }
  async function verifyDir() {
    const status = await readHost.stat(themesDir).catch((error) => {
      if (error.code !== 'NOT_FOUND') throw error;
      return { kind: 'missing' };
    });
    if (status.kind !== 'directory') throw problem('NO_THEME_DIRECTORY', 'Default host theme directory is not available');
  }
  const readSlot = (v) => readPath(readHost, slotPath(v));
  const backupKey = (v) => `preview-original-${v}`;
  const lease = (v) => acquireLease(host.storage, `studio:lease:${v}`, { writer, now, timers, settle });
  function originalRecord(raw, v) {
    const record = own(raw, v, false);
    return record && !isPreviewWriter(record.writer) && !record.previewVariant && record.origin === undefined ? record : null;
  }
  const validBackup = (backup, v) => isPreviewWriter(backup?.id) &&
    (backup.raw === null || Boolean(originalRecord(backup.raw, v)));
  async function readBackup(v) {
    const lane = lanes[v];
    if (lane.backupRead) return;
    const backup = await readOnceMoreOnTimeout(() => persistence.get(backupKey(v)));
    if (backup != null && !validBackup(backup, v)) {
      throw problem('PREVIEW_BACKUP_INVALID', 'The original theme backup could not be verified');
    }
    lane.backup = backup ?? null;
    lane.backupRead = true;
  }
  async function recoverBackup(v) {
    const lane = lanes[v], { record, raw } = lane;
    if (!orphaned(record, lane.backup) || record.origin?.writer !== record.writer) return;
    const backup = { id: record.writer, raw: record.origin.raw };
    if (!validBackup(backup, v)) return;
    lane.backup = backup;
    // The file is authoritative after uninstall. Re-cache only if no other
    // panel has advanced the journal. Never write a theme during a read.
    try {
      const lock = await lease(v);
      try {
        if (!stopped && (await persistence.get(backupKey(v)))?.id !== backup.id && await readSlot(v) === raw) {
          await lock.verify();
          if (!stopped) await persistence.set(backupKey(v), backup);
        }
      } finally { await lock.release(); }
    } catch { /* The validated on-disk origin stays usable without the cache. */ }
  }
  function previewStart(v) {
    const { record, backup, active } = lanes[v];
    if (active?.kind === 'saved') {
      const saved = getSaved().find(({ id }) => id === active.id);
      return saved?.preview ? { project: { ...saved.project, origin: { kind: 'saved', ref: saved.id } } } : null;
    }
    if (!record || record.writer !== backup?.id || active?.id !== record.id) return null;
    const original = originalRecord(backup.raw, v);
    return original?.id === record.id ? { project: original.project } : { builtin: trial(record, v)?.id };
  }
  async function saveBackup(v, raw) {
    if (raw !== null && !originalRecord(raw, v)) throw problem('PREVIEW_BACKUP_INVALID', 'The original theme could not be verified');
    await ensureOrigin();
    const backup = { id: `preview-${uid()}`, raw };
    await persistence.set(backupKey(v), backup);
    lanes[v].backup = backup;
    return backup;
  }
  async function clearBackup(v, backup) {
    if (!backup) return;
    try {
      if ((await persistence.get(backupKey(v)))?.id === backup.id) await persistence.set(backupKey(v), null);
    } catch { /* The original file has already been restored or never changed. */ }
  }
  function readBlocked(v) {
    const { readError } = lanes[v];
    return { ok: false, ...(readError ?? { code: ready ? 'FILES_UNVERIFIED' : 'HOST_UNAVAILABLE' }), stage: 'read' };
  }
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  function probe(requested) {
    const checking = requested.filter((v) => !lanes[v].probe);
    if (checking.length) {
      // The two boot lanes share one directory stat, not two independent SDK
      // requests. No cached stat is reused for a subsequent write preflight.
      const work = serial(async () => {
        const backups = checking.map((v) => readBackup(v).then(() => null, (error) => error));
        const dirError = await verifyDir().then(() => null, (error) => error);
        return Promise.all(checking.map(async (v, index) => {
          const lane = lanes[v];
          try {
            const backupError = await backups[index];
            if (dirError || backupError) throw dirError ?? backupError;
            const raw = await readSlot(v);
            if (stopped) return { ok: false, code: 'CLOSED' };
            if (!lane.known) adopt(v, raw, true);
            else {
              lane.readState = 'ready';
              lane.readError = null;
              if (raw !== lane.raw && raw !== lane.attempt?.raw) {
                return fail(v, problem('CONFLICT', 'The slot changed since the last verified read'), 'prepare');
              }
              if (lane.attempt?.interactive && raw === lane.attempt.raw) acceptWrite(v, lane.attempt);
              else if (lane.attempt?.interactive && lane.error?.stage === 'write') adopt(v, raw);
            }
            await recoverBackup(v);
            return { ok: true, stage: 'read' };
          } catch (error) { return fail(v, error, 'read'); }
        }));
      }).finally(() => {
        for (const v of checking) lanes[v].probe = null;
        publish();
      });
      for (const [index, v] of checking.entries()) {
        const lane = lanes[v];
        cancel(lane);
        lane.readState = 'checking';
        lane.readError = null;
        lane.probe = work.then((results) => results[index]);
      }
      publish();
    }
    return Promise.all(requested.map((v) => lanes[v].probe));
  }
  async function recheck(v) {
    if (!lanes[v] || stopped) return { ok: false, code: 'CLOSED' };
    if (!ready) return readBlocked(v);
    if (current(v)) sourceEpoch++;
    // The initial directory probe is shared by both modes. Recover any still
    // unknown sibling in the same read-only probe, so a later global Restore
    // doesn't fail on a mode the user never touched. Leave known lanes alone.
    const siblings = variants.filter((other) => other !== v && !lanes[other].known &&
      ['read-error', 'unavailable'].includes(lanes[other].readState));
    const [result] = await probe([v, ...siblings]);
    return result;
  }
  function canTryOn(v) {
    const lane = lanes[v];
    return current(v) && lane.active?.kind === 'builtin' && !trial(lane.record, v)
      && !lane.conflict && lane.readState === 'ready';
  }
  function applyMode(v) {
    if (trial(lanes[v].record, v) || canTryOn(v)) return 'borrow';
    return lanes[v].active?.kind === 'slot' ? 'live' : 'slot';
  }
  function previewTarget(v) {
    const lane = lanes[v], active = lane.active;
    if (!current(v) || lane.readState !== 'ready' || lane.conflict || lane.error || lane.namedError ||
        active?.namedTie || active?.reason === 'unverified-files' ||
        recoveryKind(lane.record, lane.backup, v, lane.seenRecovery)) return null;
    const key = displayed(v), receipt = lane.receipt;
    if (key && key === lane.blockedProbe) return null;
    if (key && key === lane.fallback?.before) return { ...lane.fallback.target, probe: true };
    if (key && receipt?.interactive && receipt.staleKeys.includes(key) && ['writing', 'waiting', 'timeout'].includes(lane.sync)) {
      // Old colors can appear until the watcher catches up. A named work
      // can keep a queued edit while waiting, but needs a unique live match
      // before sending that edit; a past receipt cannot disambiguate an ID.
      if (receipt.named) {
        if (lane.sync !== 'timeout' && active?.reason === 'unmatched') return { id: receipt.target, kind: 'saved' };
      } else if (active?.kind !== 'saved' && !(lane.sync === 'timeout' && receipt.pick && receipt.selectionProbe)) {
        return { id: receipt.target, kind: receipt.target === slotId(v) ? 'slot' : 'tryon',
          probe: Boolean(receipt.selectionProbe), fallback: receipt.fallback };
      }
    }
    if (lane.record && lane.record.writer === lane.backup?.id &&
        lane.sync === 'applied' && receipt?.interactive && receipt.target === lane.record.id &&
        receipt.key === key && key === lane.record.key) {
      // A witnessed change can match another factory palette (e.g. Default
      // painted onto Flexoki). Only the current preview's receipt can carry
      // that identity across the tie; the next change must prove it again.
      return { ...lane.record, kind: trial(lane.record, v) ? 'tryon' : 'slot' };
    }
    if (writable(active)) return active;
    if (active?.offers) return { ...active.offers[0], probe: true, fallback: active.offers[1] };
    if (!lane.record || lane.record.writer !== lane.backup?.id) return null;
    // For detail-only edits, factory and file may have identical fingerprints
    // and still refer to the same selection ID, not two native choices.
    const overlay = trial(lane.record, v);
    if (overlay && overlay.key === lane.record.key && key === overlay.key &&
        !getSaved().some((saved) => saved.variant === v && saved.key === overlay.key)) return overlay;
    return null;
  }
  function checkPreview(v, request) {
    const lane = lanes[v];
    return enabled && lane.generation === request.generation &&
      previewTarget(v)?.id === request.id;
  }
  function sourceTarget() {
    const id = enabled && ready && previewTarget(ready.mode)?.id;
    return id ? `${sourceEpoch}/${id}` : null;
  }
  function hasPreview() {
    const active = ready && lanes[ready.mode].active;
    if (active?.kind === 'saved') {
      const { request, inFlight, generation } = lanes[ready.mode];
      return enabled && (request?.id === active.id || inFlight?.id === active.id && inFlight.generation === generation ||
        getSaved().some(({ id, preview }) => id === active.id && preview));
    }
    return enabled && variants.some((v) => {
      const lane = lanes[v];
      return lane.request || (lane.inFlight && lane.inFlight.generation === lane.generation) || lane.attempt?.intent === 'preview' ||
        isPreviewWriter(lane.record?.writer) || (trial(lane.record, v) && !lane.record.borrowedApplied);
    });
  }
  function shownPaint(v, selected = previewTarget(v)) {
    const lane = lanes[v], record = lane.record;
    const key = current(v) && tokenKey(ready.tokens);
    if (!key) return null;
    if (lane.active?.kind === 'saved') {
      const preview = getSaved().find(({ id }) => id === lane.active.id)?.preview;
      if (preview?.key === key) return { key, variant: preview.variant };
    }
    if (record?.key === key && (lane.active?.id === record.id || !selected?.probe && selected?.id === record.id) &&
        (isPreviewWriter(record.writer) || trial(record, v) && !record.borrowedApplied)) {
      return { key, variant: record.previewVariant ?? v };
    }
    return lane.receipt?.shown?.key === key ? lane.receipt.shown : null;
  }
  function restoreNeeded(v, legacyDraft) {
    const lane = lanes[v];
    return lane.backup || isPreviewWriter(lane.record?.writer) ||
      (!lane.legacyRestored && (trial(lane.record, v) || legacyDraft));
  }
  function expectedRestoration(v, previous, restored) {
    const lane = lanes[v];
    const id = previous?.id;
    const key = current(v) && tokenKey(ready.tokens);
    if (!key || !id || !(lane.active?.id === id ||
        (lane.receipt?.target === id && (key === lane.receipt.before || key === previous.key)))) return null;
    return id === restored?.id ? restored.key : builtin(id, v)?.key;
  }
  function acceptWrite(v, attempt) {
    const lane = lanes[v];
    lane.raw = attempt.raw;
    lane.record = own(attempt.raw, v);
    lane.error = null;
    lane.conflict = false;
    lane.attempt = null;
    lane.seenRecovery = false;
    if (deactivatesPreview(attempt.intent)) {
      lane.backup = null;
      lane.legacyRestored = true;
    } else lane.legacyRestored = false;
    lane.sync = lane.receipt ? 'waiting' : 'idle';
    identify();
    const observable = Boolean(lane.receipt);
    if (lane.receipt) {
      lane.receipt.written = true;
      checkReceipt(v, lane);
      if (lane.sync === 'waiting') armTimeout(v, lane);
    }
    return { ok: true, ...attempt.fields, record: lane.record, changed: true, observable };
  }
  function enqueue(v, intent, options = {}) {
    if (!lanes[v] || stopped) return Promise.resolve({ ok: false, code: 'CLOSED' });
    const restoring = intent === 'restore';
    const recovering = intent === 'recover';
    const undoing = deactivatesPreview(intent);
    const preview = options.preview;
    if (!restoring && lanes[v].readState !== 'ready') return Promise.resolve(readBlocked(v));
    const retrying = options.attempt;
    const targetId = retrying?.targetId ?? (intent === 'tryon' ? lanes[v]?.active?.id : undefined);
    return serial(async () => {
      if (!lanes[v] || stopped) return { ok: false, code: 'CLOSED' };
      const lane = lanes[v];
      if (lane.readState !== 'ready') return readBlocked(v);
      if (restoring && !restoreNeeded(v, options.legacyDraft)) return { ok: true, changed: false };
      if (preview && !checkPreview(v, preview)) return { ok: false, code: 'MODE_CHANGED' };
      if (lane.conflict && !options.overwrite) return { ok: false, code: 'CONFLICT', stage: 'prepare' };
      if (lane.error?.stage === 'verify' && !retrying && !undoing) return { ok: false, code: 'WRITE_UNVERIFIED', stage: 'verify' };
      const continuing = canPreview(v);
      lane.preflight = true;
      const path = slotPath(v);
      let lock, stage = 'read';
      publish();
      try {
        await verifyDir();
        stage = 'prepare';
        lock = await lease(v);
        stage = 'read';
        const disk = await readSlot(v);
        stage = 'prepare';
        if (stopped) throw problem('CLOSED', 'Theme Studio was closed');
        // The previous request may have landed despite an inconclusive reply.
        // A read proving that exact version completes it without another write.
        if (retrying && disk === retrying.raw) return acceptWrite(v, retrying);
        const previous = own(disk, v);
        if (disk !== null && !previous) throw problem('CONFLICT', 'The file is not a recognized Theme Studio slot; rename it manually');
        if (retrying ? disk !== retrying.disk :
           (disk !== lane.raw && !options.overwrite && !(undoing && lane.attempt?.raw === disk))) {
          throw problem('CONFLICT', 'The slot changed in another panel or was removed');
        }
        if (undoing && lane.error?.stage === 'verify' && lane.attempt?.raw !== disk) {
          stage = 'verify';
          throw problem('WRITE_UNVERIFIED', 'The preceding write has not been verified');
        }
        if (options.guardMode && applyMode(v) !== options.mode) throw problem('MODE_CHANGED', 'The current theme changed before the write');
        const oldTrial = trial(previous, v);
        const backup = lane.backup;
        if (recovering) {
          if (!current(v) || oldTrial?.id !== options.recoveryId) throw problem('MODE_CHANGED', 'The old preview changed before recovery');
          // Only explicit recovery of a known borrowed ID is allowed, and
          // only for an old file with no original (not a malformed origin).
          if (recoveryKind(previous, backup, v, lane.seenRecovery) !== 'builtin' ||
              await persistence.get(backupKey(v)) != null) throw backupMissing();
        } else if (orphaned(previous, backup)) throw backupMissing();
        if (intent === 'end' && !oldTrial) {
          adopt(v, disk);
          return { ok: true, path, record: previous, changed: false };
        }
        let target = intent === 'slot' || intent === 'end' || undoing ? null : oldTrial;
        if (intent === 'tryon') {
          if (previous && oldTrial) throw problem('ALREADY_TRYING', 'Finish the existing trial before starting another');
          target = builtin(targetId, v);
          if (!target) throw problem('NOT_BUILTIN', 'The built-in theme cannot be identified');
          if (!current(v) || lane.active?.kind !== 'builtin' || lane.active.id !== target.id) {
            throw problem('MODE_CHANGED', 'The current theme changed before the write');
          }
        }
        if (preview) {
          const scan = await refreshSaved(true);
          if (!scan || scan.unverified) throw problem('MODE_CHANGED', 'The window theme cannot be verified');
          if (!checkPreview(v, preview)) throw problem('MODE_CHANGED', 'The current theme changed before the write');
          target = builtin(preview.id, v) ?? null;
        }
        const savedOrigin = restoring && previous?.writer && previous.writer === backup?.id;
        const alreadyRestored = restoring && backup?.raw === null && previous?.id === slotId(v) &&
          previous.writer === restoredWriter(backup.id);
        if (restoring && backup && !savedOrigin && !alreadyRestored && disk !== backup.raw) {
          throw problem('CONFLICT', 'The preview no longer owns the slot');
        }
        if (restoring && !savedOrigin && (!previous || !oldTrial && !options.legacyDraft || backup)) {
          lane.backup = null;
          lane.attempt = null;
          lane.error = null;
          lane.legacyRestored = true;
          await clearBackup(v, backup);
          return { ok: true, changed: false };
        }
        const { project, theme: sourceTheme } = savedOrigin || recovering
          ? getNeutral(v)
          : intent === 'end' || restoring && oldTrial
          ? { project: previous.project, theme: nativeDefinition(previous, v) }
          : options.legacyDraft ?? options.draft ?? getDraft(preview?.variant ?? v);
        const makingPlaceholder = recovering || savedOrigin && backup.raw === null;
        const theme = preview ? previewDefinition(sourceTheme, v) : makingPlaceholder
          ? distinguishPlaceholder(sourceTheme, new Set([...builtins, ...getSaved()].filter((item) => item.variant === v).map((item) => item.key)))
          : sourceTheme;
        if (!theme) throw problem('PLACEHOLDER_COLLISION', 'Could not give the restored theme a distinct fingerprint');
        const forcePreview = preview && lane.sync === 'timeout' && lane.receipt?.target === preview.id;
        const id = target?.id ?? slotId(v);
        const borrowedApplied = Boolean(target && (options.confirmBorrow ||
          (previous?.id === id && previous.borrowedApplied)));
        const suffix = options.locale === 'zh'
          ? borrowedApplied ? '（暂借）' : '（试穿）'
          : borrowedApplied ? ' (borrowed)' : ' (trying on)';
        const name = `Theme Studio · ${project.name}${target ? suffix : ''}`;
        const unchangedProject = previous && JSON.stringify(previous.project) === JSON.stringify(project);
        const sameContent = !restoring && previous && previous.id === id && previous.name === name
          && previous.borrowedApplied === borrowedApplied
          && !(options.commitBaseline && target && previous.borrowBaseline !== `${previous.writer}/${previous.rev}`)
          && unchangedProject
          && previous.key === themeKey(theme);
        const resultFields = { path, commitBaseline: Boolean(options.commitBaseline), mode: options.mode };
        let previewBackup;
        if (preview) {
          const source = previous?.id === id ? previous.definition : await getBuiltin(id);
          if (!checkPreview(v, preview)) throw problem('MODE_CHANGED', 'The current theme changed before the write');
          if (!forcePreview && source && (previous?.previewVariant ?? v) === preview.variant && samePaint(source, theme)) {
            return { ok: true, ...resultFields, changed: false };
          }
          previewBackup = backup && (previous?.writer === backup.id || disk === backup.raw) ? backup : await saveBackup(v, disk);
          if (previewBackup !== backup) {
            stage = 'read';
            const fresh = await readSlot(v);
            stage = 'prepare';
            if (fresh !== disk) throw problem('CONFLICT', 'The slot changed while securing its original bytes');
          }
        }
        if (!preview && sameContent && !options.overwrite && !options.resignal && !retrying) {
          // If awaiting acknowledgement for this exact version, preserve that
          // receipt instead of turning a second Apply into apparent success.
          lane.sync = lane.receipt ? (lane.timeout !== null ? 'waiting' : (current(v) && tokenKey(ready.tokens) === lane.receipt.key ? 'applied' : 'timeout')) : 'idle';
          lane.error = null;
          lane.attempt = null;
          return { ok: true, ...resultFields, record: previous, changed: false };
        }
        const rev = Math.min((previous?.rev ?? 0) + 1, Number.MAX_SAFE_INTEGER);
        // Also recognize a neutralized slot if journal cleanup failed or the
        // iframe closed after the host received the restore.
        const writeId = previewBackup?.id ?? (makingPlaceholder && isPreviewWriter(previous.writer) ? restoredWriter(previous.writer) : writer);
        const revision = `${writeId}/${rev}`;
        // The baseline reference survives unconfirmed edits and retries. A
        // confirmed rename remains recoverable if the iframe exits before the
        // matching host.storage write is delivered.
        const priorBaseline = previous?.borrowBaseline
          ?? (previous?.borrowedApplied ? `${previous.writer}/${previous.rev}` : null);
        const borrowBaseline = borrowedApplied ? options.commitBaseline || (unchangedProject && priorBaseline === `${previous.writer}/${previous.rev}`)
          ? revision : priorBaseline : null;
        await lock.verify();
        if (stopped || lane.readState !== 'ready' ||
          (recovering && !current(v)) ||
          (options.guardMode && applyMode(v) !== options.mode) ||
          (preview && !checkPreview(v, preview)) ||
          (intent === 'tryon' && (!current(v) || lane.active?.kind !== 'builtin' || lane.active.id !== target.id))) {
          throw problem('MODE_CHANGED', 'The current theme changed before the write');
        }
        const selection = preview && previewTarget(v);
        const before = displayed(v);
        const probeBefore = selection?.probe && !selection.fallback ? before : null;
        const raw = retrying?.raw ?? (savedOrigin && backup.raw !== null ? backup.raw
          : encodeTheme(theme, project, { id, name, writer: writeId, borrowedApplied, borrowBaseline, rev,
            previewVariant: preview?.variant, probeBefore, previewBackup }, { compact: !preview || preview.variant === v }));
        const leavingTrial = oldTrial && !target;
        const isSelected = lane.active?.kind === 'tryon' && lane.active.id === oldTrial?.id;
        const key = undoing ? expectedRestoration(v, previous, own(raw, v)) : preview ? themeKey(theme)
          : options.resignal ?? (leavingTrial ? isSelected ? oldTrial.key : null
          : intent === 'tryon' || continuing || lane.active?.kind === 'slot' || isSelected ? themeKey(theme) : null);
        const selectionProbe = options.resignal ? lane.receipt?.selectionProbe : selection?.probe ? before : null;
        const shown = current(v) && shownPaint(v);
        const prior = preview && lane.receipt?.interactive && lane.receipt.target === id && lane.sync !== 'applied' ? lane.receipt : null;
        resetReceipt(lane);
        const canObserve = before && key && (before !== key || selection?.probe);
        if (canObserve) lane.receipt = { key, before, target: preview?.id ?? id, interactive: Boolean(preview || undoing),
          after: observed, written: false, continuing, selectionProbe, shown, fallback: selection?.fallback,
          pick: selection?.probe ? preview : null,
          staleKeys: [...new Set([before, prior?.key, ...(prior?.staleKeys ?? [])].filter(Boolean))].slice(0, 6) };
        const { mode, locale, confirmBorrow, commitBaseline, resignal, guardMode } = options;
        const attempt = retrying ?? { raw, disk, intent, targetId: target?.id, interactive: Boolean(preview || undoing), fields: resultFields,
          options: { mode, locale, confirmBorrow, commitBaseline, resignal, guardMode, draft: { project, theme } } };
        lane.attempt = attempt;
        lane.error = null;
        lane.preflight = false;
        lane.sync = 'writing';
        stage = 'write';
        let writeError;
        try {
          const written = host.writeFile(path, raw);
          publish();
          await written;
        } catch (error) { writeError = error; }
        stage = 'verify';
        const readback = await readSlot(v);
        if (readback === raw) {
          const result = acceptWrite(v, attempt);
          if (!preview && backup) {
            lane.backup = null;
            await clearBackup(v, backup);
          }
          return result;
        }
        if (writeError && readback === disk) {
          if (writeError.code !== 'HOST_TIMEOUT') stage = 'write';
          throw writeError;
        }
        throw problem('CONFLICT', 'The slot was changed after this write');
      } catch (error) {
        return { ...fail(v, error, stage), mode: options.mode };
      } finally {
        lane.preflight = false;
        publish();
        if (lock) await lock.release().catch(() => {});
      }
    });
  }
  function canPreview(v) {
    const lane = lanes[v];
    return current(v) && lane?.record && lane.readState === 'ready' && !lane.conflict && !lane.error && !checkingSelection(lane) &&
      (lane.active?.kind === 'slot' || lane.active?.kind === 'tryon' ||
        (trial(lane.record, v) && (lane.active?.id === lane.record.id || lane.sync === 'waiting')) ||
        (lane.active?.kind === 'unknown' && lane.sync === 'waiting' && lane.receipt?.continuing));
  }
  function savedFailure(v, error, stage) {
    const report = { ok: false, code: errorCode(error), stage };
    if (!['MODE_CHANGED', 'CLOSED'].includes(report.code)) lanes[v].namedError = report;
    publish();
    return report;
  }
  const readSaved = (path) => readOnceMoreOnTimeout(() => library.readSaved(path));
  async function writeSaved(record, raw, expected) {
    const v = record.variant, lane = lanes[v], before = displayed(v);
    const selected = lane.active?.kind === 'saved' && lane.active.id === record.id;
    const observable = Boolean(selected && before && before !== expected);
    if (selected) {
      const shown = shownPaint(v);
      resetReceipt(lane);
      if (observable) lane.receipt = { key: expected, before, target: record.id, named: true,
        interactive: true, after: observed, written: false, shown, staleKeys: [before] };
      lane.sync = 'writing';
    }
    let writeError;
    try {
      const writing = host.writeFile(record.path, raw);
      publish();
      await writing;
    } catch (error) { writeError = error; }
    try {
      const readback = await readSaved(record.path);
      if (readback?.disk !== raw || !readback.lossless) {
        if (writeError && readback?.disk === record.disk) throw writeError;
        throw problem('CONFLICT', 'The saved work was changed after the write');
      }
      lane.namedError = null;
      updateSaved(readback);
      if (selected) {
        lane.sync = lane.receipt ? 'waiting' : 'idle';
        if (lane.receipt) {
          lane.receipt.written = true;
          checkReceipt(v, lane);
          if (lane.sync === 'waiting') armTimeout(v, lane);
        }
      }
      return { ok: true, path: record.path, variant: v, changed: true, observable };
    } catch (error) {
      if (selected) { resetReceipt(lane); lane.sync = 'idle'; }
      return { ...savedFailure(v, error, 'verify'), path: record.path, variant: v };
    }
  }
  function previewSaved(v, request) {
    return serial(async () => {
      if (stopped || !checkPreview(v, request)) return { ok: false, code: 'MODE_CHANGED' };
      const lane = lanes[v];
      const known = getSaved().find(({ id }) => id === request.id);
      let lock;
      lane.preflight = true;
      publish();
      try {
        lock = await lease(v);
        const scan = await refreshSaved(true);
        const record = scan?.records.find(({ id }) => id === request.id);
        if (!record?.lossless || record.disk !== known?.disk || await readSlot(v) !== lane.raw) {
          throw problem('CONFLICT', 'The saved work or its preview target changed before the write');
        }
        if (scan.unverified || stopped || !checkPreview(v, request) || lane.active?.id !== record.id) {
          throw problem('MODE_CHANGED', 'The current theme changed before the write');
        }
        const { project, theme: source } = getDraft(request.variant);
        const theme = previewDefinition(source, v);
        if ((record.preview?.variant ?? v) === request.variant &&
            samePaint(record.preview?.definition ?? record.definition, theme)) return { ok: true, changed: false };
        await ensureOrigin();
        await library.preserveRemovedEdition(record);
        const previewBackup = { id: record.preview?.writer ?? `preview-${uid()}`, raw: record.raw };
        const rev = Math.min((record.preview?.rev ?? record.rev) + 1, Number.MAX_SAFE_INTEGER);
        const raw = encodeTheme(theme, project, { id: record.id, name: record.name, writer: previewBackup.id,
          rev, previewVariant: request.variant, previewBackup }, { compact: request.variant === v }).replaceAll('\uFFFD', '\\ufffd');
        const fresh = await readSaved(record.path);
        if (!fresh?.lossless || fresh.disk !== record.disk) throw problem('CONFLICT', 'The saved work changed before the write');
        await lock.verify();
        if (stopped || !checkPreview(v, request) || lane.active?.id !== record.id) {
          throw problem('MODE_CHANGED', 'The current theme changed before the write');
        }
        lane.preflight = false;
        onNamedPreview();
        return await writeSaved(record, raw, themeKey(theme));
      } catch (error) { return savedFailure(v, error, 'prepare'); }
      finally {
        lane.preflight = false;
        publish();
        if (lock) await lock.release().catch(() => {});
      }
    });
  }
  function restoreSaved() {
    return serial(async () => {
      if (stopped) return [{ ok: false, code: 'CLOSED' }];
      const known = getSaved().filter(({ preview }) => preview);
      const scan = await refreshSaved(true);
      if (!scan) return [{ ok: false, code: 'FILES_UNVERIFIED', stage: 'read' }];
      const reports = scan.failures.map(({ path, code }) => ({ ok: false, path, code, stage: 'read' }));
      for (const original of known) {
        const found = scan.records.find(({ id }) => id === original.id);
        if (!found || found.raw !== original.raw) {
          reports.push({ ...savedFailure(original.variant, problem('CONFLICT', 'The saved work changed before Restore'), 'prepare'),
            path: original.path, variant: original.variant });
        }
      }
      for (const record of scan.records.filter(({ preview }) => preview)) {
        if (reports.some(({ path }) => path === record.path)) continue;
        const { variant: v, path } = record;
        let lock;
        try {
          lock = await lease(v);
          const fresh = await readSaved(path);
          if (fresh?.lossless && fresh.disk === record.raw) {
            updateSaved(fresh); // another panel already restored these exact bytes
            continue;
          }
          if (!fresh?.lossless || fresh.disk !== record.disk) throw problem('CONFLICT', 'The saved work changed before Restore');
          await lock.verify();
          if (stopped) throw problem('CLOSED', 'Theme Studio was closed');
          reports.push(await writeSaved(record, record.raw, record.key));
        } catch (error) {
          reports.push({ ...savedFailure(v, error, 'prepare'), path, variant: v });
        } finally { await lock?.release().catch(() => {}); }
      }
      return reports;
    });
  }
  function dispatchPreview(v) {
    const lane = lanes[v];
    const request = lane.request;
    if (!request || lane.delay !== null) return;
    if (lane.receipt?.target === request.id && (lane.receipt.interactive || lane.receipt.selectionProbe) &&
        ['writing', 'waiting'].includes(lane.sync)) return;
    lane.request = null;
    if (!checkPreview(v, request)) return;
    lane.inFlight = request;
    const work = request.mode === 'saved' ? previewSaved(v, request) :
      enqueue(v, 'preview', { preview: request, locale: request.locale, mode: request.mode });
    void work.finally(() => {
      if (lane.inFlight === request) lane.inFlight = null;
    });
  }
  function schedule(variant, locale) {
    const v = ready?.mode;
    if (!enabled || !v || !variants.includes(variant)) return;
    const lane = lanes[v], selected = previewTarget(v);
    cancel(lane);
    if (!selected) return;
    lane.request = { id: selected.id, variant, generation: lane.generation, locale,
      mode: selected.kind === 'saved' ? 'saved' : selected.kind === 'slot' ? 'live' : 'borrow' };
    lane.delay = timers.setTimeout(() => {
      lane.delay = null;
      dispatchPreview(v);
    }, debounce);
  }
  function publicLane(v) {
    const lane = lanes[v];
    const target = trial(lane.record, v);
    const recovery = recoveryKind(lane.record, lane.backup, v, lane.seenRecovery);
    const present = current(v) ? tokenKey(ready.tokens) : null;
    const awaiting = ['writing', 'waiting', 'timeout'].includes(lane.sync);
    const selected = previewTarget(v);
    const observedActive = lane.active?.kind === 'unknown' && !selected?.probe && selected?.id === lane.record?.id &&
      present && present === lane.record?.key ? selected : lane.active;
    const confirmed = current(v) && observedActive?.kind === 'tryon' && observedActive.id === target?.id && present === lane.record?.key;
    const onlySavedAfterTimeout = lane.sync === 'timeout' && lane.receipt?.selectionProbe && lane.active?.namedTie;
    const inUse = confirmed ? true : (!awaiting || onlySavedAfterTimeout) && present && present !== lane.record?.key ? false : null;
    const borrowed = target ? { id: target.id, name: target.name, applied: lane.record.borrowedApplied, inUse,
    } : null;
    let connection;
    if (!ready) connection = 'unavailable';
    else if (lane.readState !== 'ready') connection = lane.readState;
    else if (current(v) && lane.namedError) connection = 'saved-error';
    else if (lane.conflict) connection = 'conflict';
    else if (lane.error?.stage === 'write') connection = 'error';
    else if (lane.error?.stage === 'verify') connection = 'verify-error';
    else if (lane.error || recovery) connection = 'prepare-error';
    else if (!current(v)) connection = 'hidden';
    else if (target) connection = 'tryon';
    else if (lane.active?.kind === 'slot') connection = 'active';
    else connection = lane.record ? 'idle' : 'off';
    return { connection, sync: lane.preflight ? 'preflight' : lane.sync, target, targetName: target?.name,
      path: slotPath(v), exists: lane.raw !== null, active: observedActive,
      error: lane.error ?? (recovery ? { code: 'PREVIEW_BACKUP_MISSING' } : null), recovery,
      readError: lane.readError ?? (!ready ? { code: 'HOST_UNAVAILABLE' } : null),
      canRecheck: Boolean(ready), canTryOn: canTryOn(v), canPreview: Boolean(selected),
      doingTryOn: Boolean(target), borrowed, recovering: lane.seenRecovery,
       previewVariant: shownPaint(v, selected)?.variant ?? null,
       selectionBlocked: Boolean(present && !selected && (present === lane.blockedProbe ||
         ['ambiguous', 'unverified-files'].includes(lane.active?.reason))),
    };
  }
  return {
    start: () => probe(variants), recheck, setReady,
    selection: () => selection, sourceTarget, hasPreview, previewStart,
    cancelScheduled() { for (const lane of Object.values(lanes)) cancel(lane); },
    restore: (v, legacyDraft) => enqueue(v, 'restore', { legacyDraft }),
    restoreSaved,
    namedOutput(ref) {
      const v = ready?.mode;
      const lane = lanes[v], active = lane?.active, receipt = lane?.receipt;
      const id = active?.kind === 'saved' ? active.id :
        active?.kind === 'unknown' && receipt?.named && receipt.interactive ? receipt.target : null;
      const stem = (value) => value?.replace(/-(?:light|dark)$/u, '');
      const records = getSaved();
      const source = ref && !records.some((record) => record.id === ref) ? ref : stem(ref ?? id);
      if (!source) return null;
      const pair = records.filter((record) => stem(record.id) === source);
      const selected = pair.find((record) => record.id === id);
      const queued = [lane?.inFlight, lane?.request].some((request) =>
        request?.mode === 'saved' && request.id === selected?.id && request.generation === lane.generation);
      // File output uses the original work even when its preview is in the
      // other edition, or the editor opened it by name rather than from the window.
      if (!queued && !pair.some((record) => record.preview)) return null;
      return selected ?? pair.find((record) => record.variant === v) ?? pair[0];
    },
    async recheckSaved(v) {
      if (await refreshSaved()) lanes[v].namedError = null;
      publish();
    },
    recoverBuiltin(v, recoveryId) {
      if (lanes[v]) cancel(lanes[v]);
      return enqueue(v, 'recover', { recoveryId });
    },
    needsRestore: (v) => Boolean(restoreNeeded(v)),
    isPreviewRetry: (v) => Boolean(lanes[v]?.namedError || lanes[v]?.attempt?.interactive || lanes[v]?.receipt?.interactive),
    refreshCandidates() { identify(); publish(); },
    setEnabled(on) {
      enabled = Boolean(on);
      if (!enabled) {
        sourceEpoch++;
        for (const lane of Object.values(lanes)) cancel(lane);
      }
      publish();
    },
    schedule,
    tryOn(v, locale) { if (lanes[v]) cancel(lanes[v]); return enqueue(v, 'tryon', { locale }); },
    endTryOn(v) { cancel(lanes[v]); return enqueue(v, 'end'); },
    prepareSlot(v, options) { cancel(lanes[v]); return enqueue(v, 'slot', options); },
    apply(v, options) { cancel(lanes[v]); return enqueue(v, 'update', options); },
    applyDraft(v, options) {
      const lane = lanes[v];
      cancel(lane);
      if (lane.readState !== 'ready') return readBlocked(v);
      const mode = applyMode(v);
      const intent = mode === 'slot' ? 'slot' : mode === 'borrow' && !trial(lane.record, v) ? 'tryon' : 'update';
      return enqueue(v, intent, { ...options, mode, guardMode: true, commitBaseline: true, confirmBorrow: mode === 'borrow' });
    },
    retry(v, locale) {
      const lane = lanes[v];
      if (!lane || stopped) return { ok: false, code: 'CLOSED' };
      if (lane.readState !== 'ready') return recheck(v);
      if (lane.attempt?.interactive || lane.receipt?.interactive) return recheck(v);
      cancel(lane);
      if (lane.attempt) return enqueue(v, lane.attempt.intent, { ...lane.attempt.options, attempt: lane.attempt });
      if (lane.sync === 'timeout' && lane.receipt && lane.record) {
        // A witnessed disk write can still miss the watcher. Resignal exactly
        // that version, not an unconfirmed draft the user edited afterwards.
        return enqueue(v, 'update', { locale, resignal: lane.receipt.key,
          draft: { project: lane.record.project, theme: lane.record.definition } });
      }
      return { ok: false, code: 'NO_RETRY' };
    },
    async resolve(v, action, locale) {
      if (action === 'overwrite') return enqueue(v, 'update', { overwrite: true, locale, commitBaseline: true });
      return serial(async () => {
        if (stopped) return { ok: false, code: 'CLOSED' };
        let raw;
        try {
          await verifyDir();
          raw = await readSlot(v);
        } catch (error) {
          const result = fail(v, error, 'read');
          publish();
          return result;
        }
        adopt(v, raw);
        if (lanes[v].record?.writer !== lanes[v].backup?.id) lanes[v].backup = null;
        await recoverBackup(v);
        publish();
        return lanes[v].conflict ? { ok: false, code: 'CONFLICT', stage: 'prepare' } : { ok: true, record: lanes[v].record };
      });
    },
    lane: publicLane,
    record: (v) => lanes[v].record,
    async keep(v, locale) {
      const record = lanes[v]?.record;
      if (!record) return { ok: false, code: 'NOT_FOUND' };
      return enqueue(v, 'update', { locale, confirmBorrow: true, commitBaseline: true,
       draft: { project: record.project, theme: nativeDefinition(record, v) } });
    },
    dismiss(v) { lanes[v].seenRecovery = false; publish(); },
    dispose() {
      stopped = true;
      for (const lane of Object.values(lanes)) { clear(lane, 'delay'); clear(lane, 'timeout'); }
    },
  };
}
