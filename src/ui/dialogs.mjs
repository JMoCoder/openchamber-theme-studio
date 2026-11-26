import { button, node } from './dom.mjs';
import { FILE_LIMIT, variantsFor } from './model.mjs';

const measuredBytes = (text) => new TextEncoder().encode(text).length;

function pathText(item) {
  if (typeof item === 'string') return item;
  const path = item?.path ?? item?.key;
  return Array.isArray(path) ? path.join('.') : path;
}

function fileOutcome(report) {
  const collection = report?.files ?? report?.paths ?? [];
  const entries = Array.isArray(collection) ? collection : [];
  return {
    paths: entries.filter((item) => item?.ok !== false).map(pathText).filter(Boolean),
    failed: report?.ok !== true || entries.some((item) => item?.ok === false),
  };
}

// Translate mounted controls instead of rebuilding an open sheet: field values,
// caret/selection and any pending file operation keep their own DOM and state.
function sheetLanguage(context) {
  const bindings = [];
  function bind(setter, key, params) {
    const update = () => {
      const { t } = context();
      setter(t(typeof key === 'function' ? key() : key, (typeof params === 'function' ? params(t) : params) ?? {}));
    };
    update();
    bindings.push(update);
  }
  function text(tag, key, params, props) {
    const element = node(tag, props);
    bind((value) => { element.textContent = value; }, key, params);
    return element;
  }
  function attr(element, name, key, params) { bind((value) => element.setAttribute(name, value), key, params); }
  function control(key, options, params) {
    const element = button(context().t(typeof key === 'function' ? key() : key), options);
    if (options.iconOnly) {
      attr(element, 'title', key, params);
      attr(element, 'aria-label', key, params);
    } else {
      bind((value) => { element.querySelector('.u-button-label').textContent = value; }, key, params);
    }
    return element;
  }
  return { text, attr, control, translate() { bindings.forEach((update) => update()); } };
}

export function createDialogs(root, context) {
  let current;
  function close() { current?.element.close(); }
  function sheet(titleKey, content) {
    close();
    const origin = document.activeElement, restoreKey = origin?.dataset.focus;
    const lang = sheetLanguage(context);
    const element = node('dialog', { class: 'u-dialog', 'aria-labelledby': 'dialog-title' },
      node('div', { class: 'dialog-heading' }, lang.text('h2', titleKey, null, { id: 'dialog-title' }),
        lang.control('close', { glyph: 'x', iconOnly: true, kind: 'u-icon', onclick: close })));
    const view = { element, close, ...lang };
    const { body, focus, onOpen } = content(view);
    element.append(node('div', { class: 'dialog-body' }, body));
    current = view;
    element.addEventListener('close', () => {
      element.remove();
      if (current !== view) return;
      current = null;
      if (origin?.isConnected && !origin.closest('[hidden]')) origin.focus({ preventScroll: true });
      else if (restoreKey) [...root.querySelectorAll('[data-focus]')]
        .find((target) => target.dataset.focus === restoreKey)?.focus({ preventScroll: true });
      if (document.activeElement === document.body) root.querySelector('#editor-panel')?.focus({ preventScroll: true });
    }, { once: true });
    root.append(element);
    element.showModal();
    focus?.focus();
    onOpen?.();
  }
  function closers(view, key = 'cancel') {
    return view.control(key, { kind: 'u-secondary', onclick: close });
  }
  function feedback(view, className = 'dialog-outcome') {
    const result = node('div', { class: className, role: 'status', 'aria-live': 'polite' });
    let shown;
    const set = (key, type, params) => {
      shown = { key, params };
      result.hidden = !key;
      result.className = `${className}${type ? ` ${type}-inline` : ''}`;
      view.translate();
    };
    // A blank, hidden status keeps a stable element for assistive tech and locale changes.
    result.replaceChildren(view.text('p', () => shown?.key ?? '', (t) => typeof shown?.params === 'function' ? shown.params(t) : shown?.params));
    result.hidden = true;
    return { result, set };
  }

  function file(mode) {
    const { state, studio, copyText } = context(), saving = mode === 'save';
    sheet(mode, (view) => {
      const name = node('input', { value: state.live?.outputOriginal ?? state.project.name, type: 'text', maxlength: 80 });
      view.attr(name, 'aria-label', 'saveName');
      const choices = node('select', {}, ['both', 'light', 'dark'].map((v) => view.text('option', v, null, { value: v })));
      choices.value = saving ? 'both' : state.variant;
      view.attr(choices, 'aria-label', 'selectVariants');
      const outcome = feedback(view);
      const paths = node('div', { class: 'dialog-files' });
      const copied = feedback(view, 'file-feedback');
      const cancel = closers(view);
      const submit = view.control(mode, { glyph: saving ? 'file' : 'download', kind: 'u-primary', onclick: write });
      const done = view.control('done', { kind: 'u-primary', hidden: true, onclick: close });
      async function write() {
        if (submit.disabled) return;
        const label = name.value.trim();
        if (saving && !label) {
          name.setAttribute('aria-invalid', 'true'); name.focus();
          outcome.set('saveNameRequired', 'issue');
          return;
        }
        submit.disabled = true;
        paths.replaceChildren(); copied.set('');
        outcome.set('saveBusy');
        let value;
        try {
          const variants = variantsFor(choices.value);
          value = await (saving ? studio.saveAs({ name: label, variants }) : studio.exportFiles({ variants }));
        } catch { value = false; }
        if (!view.element.open) return;
        const report = fileOutcome(value), any = report.paths.length > 0;
        submit.disabled = !report.failed;
        const key = any ? report.failed ? 'reportPartial' : saving ? 'reportSaved' : 'reportExport'
          : value?.code === 'NO_DOWNLOAD_DIRECTORY' ? 'workspaceNoDownloads' : saving ? 'reportFail' : 'reportExportFail';
        outcome.set(key, report.failed ? 'issue' : 'success');
        for (const path of report.paths) {
          paths.append(node('div', { class: 'report-file' }, node('code', { text: path }),
            view.control('copyPath', { iconOnly: true, glyph: 'copy', kind: 'u-mini', onclick: async () => {
              const ok = await copyText(path, 'copiedPath', { silent: true });
              copied.set(ok ? 'copiedPath' : 'copyFailed', ok ? 'success' : 'issue');
            } })));
        }
        done.hidden = report.failed;
        if (!report.failed) {
          cancel.hidden = submit.hidden = true;
          if (document.activeElement === document.body || document.activeElement === name) done.focus();
        }
      }
      name.addEventListener('input', () => name.removeAttribute('aria-invalid'));
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && !event.repeat) { event.preventDefault(); void write(); }
      });
      return { focus: saving ? name : choices, body: node('div', { class: 'dialog-stack' },
        view.text('p', saving ? 'saveHint' : 'exportHint', null, { class: 'u-muted' }),
        state.live?.outputOriginal && view.text('p', 'savedOutputHint', null, { class: 'u-muted' }),
        saving && node('label', { class: 'u-field' }, view.text('span', 'saveName'), name),
        node('label', { class: 'u-field' }, view.text('span', 'variants'), choices),
        !saving && view.text('p', 'exportManual', null, { class: 'u-muted' }),
        outcome.result, paths, copied.result,
        node('div', { class: 'dialog-actions' }, cancel, submit, done)) };
    });
  }

  function manualJson(json, variant) {
    sheet('manualJson', (view) => {
      const text = node('textarea', { class: 'manual-json', readonly: true, spellcheck: 'false', rows: 9, value: json });
      view.attr(text, 'aria-label', 'manualJson');
      const select = () => { text.focus(); text.select(); };
      return { focus: text, onOpen: select, body: node('div', { class: 'dialog-stack' },
        view.text('p', 'manualJsonHint', (t) => ({ variant: t(variant) }), { class: 'u-muted' }), text,
        node('div', { class: 'dialog-actions' }, closers(view, 'close'),
          view.control('selectAll', { kind: 'u-primary', glyph: 'copy', onclick: select }))) };
    });
  }

  function importDialog({ incoming } = {}) {
    const { studio } = context();
    sheet('importTitle', (view) => {
      const result = feedback(view);
      const details = node('div', { class: 'dialog-files' });
      const paste = node('textarea', { spellcheck: 'false', rows: 5 });
      view.attr(paste, 'aria-label', 'importPaste');
      view.attr(paste, 'placeholder', 'importPlaceholder');
      const picker = node('input', { type: 'file', accept: '.json,application/json', tabindex: -1, class: 'visually-hidden' });
      const done = view.control('done', { kind: 'u-link', hidden: true, onclick: close });
      const message = (key, error) => {
        details.replaceChildren();
        result.set(key, error ? 'issue' : 'success');
        paste.setAttribute('aria-invalid', String(error));
        done.hidden = error;
      };
      const showList = (items, key) => {
        const paths = [...new Set(items.map(pathText).filter(Boolean))];
        if (paths.length) details.append(node('div', { class: 'import-report' }, view.text('h3', key),
          node('ul', {}, paths.map((path) => node('li', {}, node('code', { text: path }))))));
      };
      const consume = (text, filename) => {
        if (measuredBytes(text) > FILE_LIMIT) return message('importSize', true);
        if (!text.trim()) return message('importFailed', true);
        let report;
        try { report = studio.importText(text, filename); }
        catch { return message('importFailed', true); }
        if (report?.kind === 'vscode' || report?.code === 'VSCODE_THEME') return message('importVSCode', true);
        if (report?.code === 'FILE_TOO_LARGE') return message('importSize', true);
        if (report?.ok !== true) { message('importFailed', true); showList(report?.issues ?? [], 'importIssues'); return; }
        message('importOk', false);
        showList(report.warnings ?? [], 'importIgnored');
      };
      const load = async (file) => {
        if (!file || !view.element.open) return;
        if (file.size > FILE_LIMIT) return message('importSize', true);
        try { const text = await file.text(); if (view.element.open) consume(text, file.name); }
        catch { if (view.element.open) message('importFailed', true); }
      };
      picker.addEventListener('change', () => { void load(picker.files[0]); picker.value = ''; });
      const area = node('div', { class: 'import-drop', 'data-import-drop': true },
        view.text('p', 'importHint', null, { class: 'u-muted' }),
        view.control('importPick', { glyph: 'upload', kind: 'u-secondary', onclick: () => picker.click() }), picker);
      area.addEventListener('dragenter', (event) => { event.preventDefault(); area.classList.add('dropping'); });
      area.addEventListener('dragover', (event) => event.preventDefault());
      area.addEventListener('dragleave', (event) => { if (!area.contains(event.relatedTarget)) area.classList.remove('dropping'); });
      area.addEventListener('drop', (event) => {
        event.preventDefault(); event.stopPropagation(); area.classList.remove('dropping'); void load(event.dataTransfer?.files?.[0]);
      });
      const pasteCommit = () => consume(paste.value, '');
      paste.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !event.repeat) {
          event.preventDefault(); pasteCommit();
        }
      });
      return { focus: paste, onOpen: () => { if (incoming) void load(incoming); }, body: node('div', { class: 'dialog-stack' },
        area, node('label', { class: 'u-field' }, view.text('span', 'importPaste'), paste),
        node('div', { class: 'dialog-actions' }, closers(view),
          view.control('importCommit', { kind: 'u-primary', onclick: pasteCommit })), result.result, details, done) };
    });
  }

  function manageSaved(card) {
    const { studio, copyText, removeSaved } = context();
    const observed = variantsFor('both').flatMap((variant) => {
      const entry = card.variants?.[variant];
      return entry?.path ? [{ ...entry, variant }] : [];
    });
    sheet('manageSavedTitle', (view) => {
      let report, verified = false;
      const outcome = feedback(view);
      const copied = feedback(view, 'file-feedback');
      const files = node('ul', { class: 'saved-files' }, observed.map(({ variant, name, path }) =>
        node('li', { class: 'saved-file' },
          node('div', { class: 'saved-file-title' }, view.text('span', variant), node('strong', { text: name ?? card.name }),
            view.text('span', () => verified && report.missing.includes(path) ? 'nativeMissing' : '',
              null, { class: 'saved-file-status' })),
          node('div', { class: 'report-file' }, node('code', { text: path }),
            view.control('copyVariantPath', { iconOnly: true, glyph: 'copy', kind: 'u-mini',
              onclick: async () => {
                const ok = await copyText(path, 'copiedPath', { silent: true });
                if (view.element.open) copied.set(ok ? 'copiedPath' : 'copyFailed', ok ? 'success' : 'issue');
              } }, (t) => ({ variant: t(variant) }))))));
      const check = view.control('checkSavedFiles', { kind: 'u-primary', glyph: 'check', onclick: verify });
      const done = view.control('done', { kind: 'u-primary', hidden: true, onclick: close });
      const remove = view.control('removeListOnly', { kind: 'u-link', onclick: removeFromList });
      check.disabled = !observed.length;
      let busy = false;
      async function verify() {
        if (busy || check.disabled) return;
        busy = check.disabled = remove.disabled = true;
        verified = false;
        outcome.set('checkingSavedFiles');
        try { report = await studio.checkSavedFiles(card); }
        catch { report = null; }
        if (!view.element.open) return;
        const paths = observed.map(({ path }) => path);
        verified = report?.ok === true && Array.isArray(report.missing) && Array.isArray(report.remaining) &&
          paths.every((path) => report.missing.includes(path) !== report.remaining.includes(path));
        const missing = verified && paths.filter((path) => report.missing.includes(path)).length;
        const gone = verified && report.remaining.length === 0 && missing === paths.length;
        const key = !verified ? 'checkSavedFailed' : gone ? 'nativeDeleted' : missing ? 'nativePartlyDeleted' : 'nativeStillPresent';
        outcome.set(key, !verified ? 'issue' : gone ? 'success' : '');
        busy = false;
        check.disabled = gone;
        check.hidden = remove.hidden = gone;
        remove.disabled = false;
        done.hidden = !gone;
        if (gone && document.activeElement === document.body) done.focus();
      }
      async function removeFromList() {
        if (busy) return;
        busy = check.disabled = remove.disabled = true;
        const ok = await removeSaved(card);
        if (!view.element.open) return;
        if (ok) { close(); return; }
        outcome.set('removeSavedFailed', 'issue');
        busy = remove.disabled = false;
        check.disabled = !observed.length;
      }
      return { focus: view.element.querySelector('.dialog-heading .u-button'), body: node('div', { class: 'dialog-stack' },
        node('p', { class: 'saved-work-name', text: card.name }),
        view.text('p', observed.length ? 'deleteInAppearance' : 'savedNoFiles', null, { class: 'u-muted' }),
        files, copied.result, outcome.result,
        node('div', { class: 'dialog-actions saved-delete-actions' }, check, done),
        node('div', { class: 'saved-list-only' }, remove)) };
    });
  }

  function cleanup(recovery = false) {
    sheet(recovery ? 'recoveryKeepTitle' : 'cleanup', (view) => {
      const instructions = node('div', { class: 'dialog-stack' },
        view.text('p', 'recoverBuiltin'), view.text('p', 'recoverDraft', null, { class: 'u-muted' }));
      return { body: node('div', { class: 'dialog-stack' },
        !recovery && view.text('p', 'cleanupHint'),
        recovery ? view.text('p', 'recoverKeepGuide') : node('details', { class: 'limits' }, view.text('summary', 'recoveryTitle'), instructions),
        node('div', { class: 'dialog-actions' }, closers(view, 'done'))) };
    });
  }
  return { file, importDialog, manualJson, manageSaved, cleanup, close,
    translate() { current?.translate(); }, get isOpen() { return Boolean(current?.element.open); } };
}
