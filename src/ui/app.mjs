import defaultCatalog from '../../data/fields.json' with { type: 'json' };
import { button, icon, node, segment, toggle } from './dom.mjs';
import { createDialogs } from './dialogs.mjs';
import { chromePalette, filesUnchecked, fileUnavailableNote, isHex, language, schemeForBackground, statusOf, TABS, VARIANTS, words, writeNeedsRetry } from './model.mjs';
import { createPages } from './pages.mjs';
import { makeColorConverter } from './picker.mjs';
import { miniPreview, previewColors } from './preview.mjs';
import { createRefinement } from './refine.mjs';

const tabIcons = { theme: 'layers', style: 'sparkle', tune: 'sliders', refine: 'droplet', matching: 'type' };
const noop = () => {};
const validFont = (value) => typeof value === 'string' && value.length < 400
  && !/[;{}<>\\]/.test(value) && !/\b(?:var|env|attr|url)\s*\(/i.test(value) && CSS.supports('font-family', value);

export function mountStudio(root, studio, { catalog = defaultCatalog, onFrame = noop } = {}) {
  const pages = createPages(), refine = createRefinement(catalog), convert = makeColorConverter();
  let state = studio.getState(), locale = language(state.locale), t = words(locale), tab = 'theme';
  let frame = 0, lastState = {}, needPage = true, gesturePhase = '', dragging = false, sliderCommit, fontAndPaletteKey, installedPrefs = false;
  let lastNotice, toastTimer, toastMessage, menu, preview, rename, navButtons = [];
  const savedScroll = Object.create(null);
  const view = { collapsed: false, focusPath: '', pending: new Set(), statusHelp: false, restoring: false,
    undoingSaved: new Set() };
  const appTitle = node('h1', { class: 'visually-hidden', text: t('app') });
  const header = node('header', { class: 'studio-header' });
  const banners = node('div', { class: 'studio-banners' });
  const previewPane = node('section', { class: 'preview-pane' });
  const nav = node('div', { class: 'studio-tabs', role: 'tablist', 'aria-orientation': 'horizontal' });
  const main = node('main', { class: 'studio-main', id: 'editor-panel', role: 'tabpanel', tabindex: 0 });
  const foot = node('footer', { class: 'studio-foot' });
  const toast = node('div', { class: 'studio-toast', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', hidden: true });
  root.classList.add('studio');
  root.replaceChildren(appTitle, header, banners, previewPane, nav, main, foot, toast);

  function context() {
    return { state, locale, t, studio, refine, convert, changePhase, refresh, copyText, removeSaved,
      undoingSaved: view.undoingSaved, labelFor: (path) => refine.labelFor(path, locale) };
  }
  const dialogs = createDialogs(root, context);

  const focusKeys = (area) => [...area.querySelectorAll('[data-focus]')];
  function recoverFocus(area, el, key) {
    if (el?.isConnected && el !== document.activeElement && !el.closest('[hidden]')) el.focus({ preventScroll: true });
    else if (key) focusKeys(area).find((node) => node.dataset.focus === key && !node.disabled && !node.closest('[hidden]'))?.focus({ preventScroll: true });
  }
  function replace(area, ...content) {
    const focused = area.contains(document.activeElement) ? document.activeElement : null;
    const key = focused?.dataset.focus;
    const sel = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    area.replaceChildren(...content.flat(Infinity).filter(Boolean));
    if (focused) {
      recoverFocus(area, focused, key);
      if (sel && typeof document.activeElement?.setSelectionRange === 'function') document.activeElement.setSelectionRange(...sel);
    }
  }

  function queue() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  function refresh() { needPage = true; queue(); }
  function changePhase(phase, fn, keepSliders = false) {
    gesturePhase = phase;
    dragging = phase === 'drag';
    const started = phase === 'drag' ? performance.now() : 0;
    try { return fn(); }
    catch { toastText('unknownError', 'error'); return; }
    finally {
      gesturePhase = '';
      if (phase === 'drag') onFrame(performance.now() - started);
      else if (keepSliders) { sliderCommit = { tab, variant: state.variant, project: state.project }; queue(); }
      else refresh();
    }
  }
  // Above the style controls, which sit at the bottom of the list.
  function placeToast() {
    const bar = main.querySelector('.style-settings');
    toast.style.bottom = bar ? `${Math.ceil(root.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) + 6}px` : '';
  }
  function toastText(key, tone = 'info', params) {
    clearTimeout(toastTimer);
    toastMessage = { key, params };
    toast.dataset.tone = tone;
    toast.hidden = false;
    toast.textContent = t(key, params);
    placeToast();
    toastTimer = setTimeout(() => { toast.hidden = true; toastMessage = null; toast.textContent = ''; }, 4800);
  }
  function reportNotice() {
    if (!state.notice || state.notice.id === lastNotice) return;
    lastNotice = state.notice.id;
    const { textKey, params, tone } = state.notice;
    const key = textKey?.replace(/^(ui\.)/, '');
    if (!key) return;
    if (t(key, params) !== key) toastText(key, tone, params);
  }
  async function run(fn, { track = false, variant = state.variant, silent = false } = {}) {
    if (track && view.pending.has(variant)) return false;
    if (track) { view.pending.add(variant); queue(); }
    try { return await fn(); }
    catch { if (!silent) toastText('unknownError', 'error'); return false; }
    finally { if (track) { view.pending.delete(variant); queue(); } }
  }
  async function copyText(value, message = 'copied', { silent = false } = {}) {
    if (!value) { if (!silent) toastText('noResult', 'warning'); return false; }
    const ok = typeof studio.copyText === 'function' && await run(() => studio.copyText(value), { silent: true }) === true;
    if (!silent) toastText(ok ? message : 'copyFailed', ok ? 'success' : 'warning');
    return ok;
  }
  async function reportJsonCopy(variant, ok, earlier) {
    if (ok === false && !dialogs.isOpen && typeof studio.getJson === 'function') {
      const json = await run(() => studio.getJson(variant), { silent: true });
      if (typeof json === 'string' && json) { dialogs.manualJson(json, variant); return; }
    }
    if (ok !== false || earlier === state.notice?.id) toastText(ok === false ? 'noClipboard' : 'textReady', ok === false ? 'warning' : 'success');
  }
  async function copyJson(variant = state.variant) {
    const earlier = state.notice?.id;
    const ok = await run(() => studio.copyJson(variant), { silent: true });
    await reportJsonCopy(variant, ok, earlier);
  }
  async function removeSaved(card) {
    const result = await run(() => studio.removeSaved(card.id), { silent: true });
    if (result !== true && result?.ok !== true) return false;
    pages.view.showRemoved = true;
    refresh();
    toastText('savedRemoved', 'success');
    requestAnimationFrame(() => focusKeys(main).find((el) => el.dataset.focus === `saved:undo:${card.id}`)?.focus());
    return true;
  }
  async function undoRemoveSaved(id) {
    if (!state.library?.removed?.some((card) => card.id === id) || view.undoingSaved.has(id)) return;
    view.undoingSaved.add(id);
    refresh();
    const result = await run(() => studio.undoRemoveSaved(id), { silent: true });
    view.undoingSaved.delete(id);
    if (result === true || result?.ok === true) {
      toastText('savedRestored', 'success');
      requestAnimationFrame(() => focusKeys(main).find((el) => el.dataset.focus === `manage-saved:${id}`)?.focus());
    } else toastText('undoRemoveFailed', 'error');
    refresh();
  }

  function inheritChrome() {
    const tokens = state.host?.tokens ?? {};
    const mode = state.host?.mode ?? 'light';
    const key = JSON.stringify([mode, tokens]);
    if (fontAndPaletteKey === key) return;
    fontAndPaletteKey = key;
    const colors = chromePalette(tokens, mode, convert);
    root.dataset.mode = schemeForBackground(colors.bg);
    for (const [name, value] of Object.entries(colors)) root.style.setProperty(`--u-${name}`, value);
    for (const [name, input] of [['font', tokens.font], ['mono', tokens.mono]]) {
      if (validFont(input)) root.style.setProperty(`--u-${name}`, input);
      else root.style.removeProperty(`--u-${name}`);
    }
    if (/^\d+(\.\d+)?px$/.test(tokens.fontSize ?? '')) {
      root.style.setProperty('--u-size', `${Math.max(12, Math.min(15, 13 * parseFloat(tokens.fontSize) / 16))}px`);
    } else root.style.removeProperty('--u-size');
    const radius = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)$/.test(tokens.radius ?? '') ? parseFloat(tokens.radius) * (tokens.radius.endsWith('rem') ? 16 : 1) : 7;
    root.style.setProperty('--u-radius', `${Math.max(4, Math.min(11, radius))}px`);
  }
  function sampleUpdate() {
    if (preview && !view.collapsed) {
      const v = state.variant;
      previewColors(preview, state.parsed?.[v], state.cssVars?.[v]);
    }
  }
  function simpleControl(label, action, glyph, props = {}) {
    return button(label, { action, glyph, kind: 'u-secondary', 'data-focus': action, ...props });
  }
  const pending = (status) => view.pending.has(status.variant) || ['preflight', 'writing', 'waiting'].includes(status.sync);
  const unavailable = (status) => filesUnchecked(status) || state.phase === 'booting';
  function statusActions(status) {
    if (state.phase === 'booting' || status.connection === 'checking') return null;
    const busy = pending(status);
    const at = (label, action, glyph, props) => simpleControl(t(label), action, glyph, {
      kind: 'u-link status-action', 'data-focus': `connection:${action}`,
      disabled: busy, ...props,
    });
    if (unavailable(status)) return status.live.canRecheck && at('recheckFiles', 'recheck-files');
    if (status.connection === 'conflict') return null;
    if (status.backupMissing) return status.recovery !== 'builtin' && at('recoveryGuide', 'recovery-guide', 'info');
    if (writeNeedsRetry(status) || status.sync === 'timeout' && !status.selectionPaused) return at('retry', 'retry');
    return at('statusHelp', 'show-status-help', 'info', { iconOnly: true, disabled: false,
      'aria-expanded': String(view.statusHelp), 'aria-controls': 'studio-connection-help' });
  }
  function previewHelp(status) {
    const name = status.borrowed?.name ?? (status.canBorrow ? status.active?.name : null);
    return view.statusHelp && node('div', { id: 'studio-connection-help', class: 'preview-help' },
      node('p', { text: t('previewLifecycle') }), node('p', { text: t('previewNativeMode') }),
      name && node('p', { text: t('borrowEffect', { name }) }));
  }
  function banner(tone, message, actions = []) {
    const glyph = { error: 'warning', warning: 'warning', success: 'check' }[tone] ?? 'info';
    return node('div', { class: 'u-banner', 'data-tone': tone }, icon(glyph, 17),
      node('div', {}, node('p', { text: message }), actions.length > 0 && node('div', { class: 'banner-actions' }, actions)));
  }
  function statusBanners(status) {
    const displayed = [], { connection, sync } = status;
    const busy = pending(status);
    const at = (label, act, glyph, props) => simpleControl(t(label), act, glyph, { disabled: busy, ...props });
    switch (connection) {
      case 'unavailable':
        displayed.push(banner('warning', t(fileUnavailableNote(status.live.readError?.code)))); break;
      case 'read-error':
        displayed.push(banner('warning', t('filesReadNote'))); break;
      case 'conflict':
        displayed.push(banner('warning', t('conflictNote'), [at('loadTheirs', 'resolve-load', 'download'), at('useMine', 'resolve-overwrite', 'upload')])); break;
      case 'error':
        displayed.push(banner('error', t('errorNote'))); break;
      case 'prepare-error':
        if (status.recovery === 'builtin') {
          displayed.push(banner('warning', t('legacyBuiltinNote', { name: status.borrowed?.name }), [
            at('recoverBuiltinAction', 'recover-builtin', 'reset', { 'data-id': status.borrowed?.id }),
          ]));
        } else displayed.push(banner('warning', t(status.backupMissing ? 'previewBackupMissing' : 'prepareNote')));
        break;
      case 'verify-error':
        displayed.push(banner('warning', t('verifyNote'))); break;
      case 'off':
      case 'idle':
        if (status.active?.reason === 'ambiguous' && !status.live.canPreview && !status.selectionPaused) displayed.push(banner('info', t('ambiguousNote')));
        break;
    }
    if (status.selectionPaused) displayed.push(banner('warning', t('selectionPausedNote')));
    else if (sync === 'timeout' && ['off', 'idle', 'tryon', 'active'].includes(connection)) {
      displayed.push(banner('warning', t('timeoutNote')));
    }
    return displayed;
  }

  function buildHeader(status) {
    const name = state.project?.name || t('untitled');
    const wasOpen = menu?.open;
    const ready = state.phase !== 'booting';
    const statusFocused = header.contains(document.activeElement) && document.activeElement.closest('.status-actions');
    const nameInput = node('input', { class: 'project-name', value: name, spellcheck: 'false', maxlength: 80, 'aria-label': t('rename'),
      title: name, 'data-focus': 'project-name', disabled: state.phase === 'booting', onfocus(event) { event.currentTarget.select(); },
      onkeydown(event) {
        if (!event.isComposing && (event.key === 'Enter' || event.key === 'Escape')) {
          event.preventDefault(); if (event.key === 'Escape') event.target.value = state.project?.name ?? name;
          event.target.blur();
        }
      },
      onblur(event) {
        if (event.target !== rename) return;
        const next = event.target.value.trim();
        if (next && next !== state.project?.name) studio.rename(next); else event.target.value = state.project?.name ?? name;
      },
    });
    if (document.activeElement === rename && rename) nameInput.value = rename.value;
    rename = nameInput;
    const menuItem = (key, act, glyph, disabled = false) => button(t(key), { action: act, glyph, kind: 'menu-item', disabled, 'data-focus': `menu:${act}` });
    menu = node('details', { class: 'studio-menu', open: Boolean(wasOpen) },
      node('summary', { class: 'u-button is-icon u-icon', 'aria-label': t('more'), title: t('more'), 'data-focus': 'menu' }, icon('more', 18)),
      node('div', { class: 'menu-tray' },
        node('div', { class: 'menu-switch' }, toggle(t('live'), { act: 'live', checked: state.live?.enabled !== false, disabled: !ready })),
        node('div', { class: 'menu-separator' }),
        menuItem('export', 'export', 'download', !ready), menuItem('copyJson', 'copy-json', 'copy', !ready), menuItem('import', 'import', 'upload', !ready),
        node('div', { class: 'menu-separator' }),
        menuItem('cleanup', 'cleanup', 'shield', !ready)));
    const toggleVariant = segment(VARIANTS.map((value) => ({ label: t(value), value, icon: value === 'light' ? 'sun' : 'moon' })), state.variant, 'variant', t('variant'));
    for (const control of toggleVariant.querySelectorAll('button')) {
      control.dataset.focus = `variant:${control.dataset.value}`;
      control.disabled = state.phase === 'booting';
    }
    replace(header,
      node('div', { class: 'header-top' },
        node('a', { href: '#editor-panel', class: 'skip-link', onclick(event) { event.preventDefault(); main.focus(); }, text: t('skip') }),
        node('div', { class: 'project-title' }, icon('palette', 18), rename,
          button(t('rename'), { action: 'rename', kind: 'rename-button', glyph: 'pencil', iconOnly: true, disabled: state.phase === 'booting' })),
        toggleVariant, menu),
      node('div', { class: 'header-bottom' },
        node('div', { class: 'header-status' },
          node('span', { class: 'connection', 'data-tone': status.tone, 'data-sync': status.sync, role: 'status',
            'aria-live': 'polite', tabindex: -1, 'data-focus': 'connection:status' },
           node('i', { 'aria-hidden': 'true' }), node('span', { text: status.text }))),
        node('div', { class: 'status-actions' }, statusActions(status))));
    if (statusFocused && document.activeElement === document.body) {
      (header.querySelector('.status-actions button:not(:disabled)') ?? header.querySelector('.connection'))?.focus({ preventScroll: true });
    }
  }

  function buildPreview(rebuild) {
    if (!preview || rebuild) preview = miniPreview(t, (path) => refine.labelFor(path, locale));
    sampleUpdate();
    const toggleButton = button(t('preview'), { action: 'toggle-preview', class: 'preview-toggle', 'aria-expanded': String(!view.collapsed),
      'aria-controls': 'studio-preview-frame', 'aria-label': t(view.collapsed ? 'showPreview' : 'hidePreview'), 'data-focus': 'preview-toggle' },
    icon('eye', 15), icon(view.collapsed ? 'chevron' : 'down', 14));
    replace(previewPane, node('div', { class: 'preview-heading' }, toggleButton,
      !view.collapsed && node('span', { class: 'preview-hint u-muted', text: t('previewShort'), title: t('previewHint') })),
    node('div', { class: 'preview-frame', id: 'studio-preview-frame', hidden: view.collapsed }, preview));
  }
  function buildTabs(rebuild) {
    if (rebuild || !navButtons.length) {
      nav.setAttribute('aria-label', t('workspace'));
      navButtons = TABS.map((key) => button(t(key), { action: 'tab', glyph: tabIcons[key], class: 'tab-button', role: 'tab',
        id: `tab-${key}`, 'aria-controls': 'editor-panel', 'data-id': key, 'data-focus': `tab:${key}` }));
      replace(nav, navButtons);
    }
    for (const b of navButtons) {
      const selected = b.dataset.id === tab;
      b.tabIndex = selected ? 0 : -1;
      b.disabled = state.phase === 'booting';
      b.setAttribute('aria-selected', String(selected));
    }
    main.setAttribute('aria-labelledby', `tab-${tab}`);
  }
  function buildFooter(status) {
    const s = state;
    const history = (key, glyph, disabled) => simpleControl(t(key), key, glyph, { kind: 'u-icon', iconOnly: true, disabled });
    replace(foot, node('div', { class: 'history-actions' },
      history('undo', 'undo', view.restoring || !s.history?.canUndo), history('redo', 'redo', view.restoring || !s.history?.canRedo)),
    node('div', { class: 'footer-actions' },
      simpleControl(t(view.restoring ? 'restoring' : 'restore'), 'restore', 'reset', { kind: 'u-secondary footer-restore',
        title: t('restoreHint'), disabled: view.restoring || s.phase === 'booting' }),
      simpleControl(t('save'), 'save', 'file', { kind: 'u-primary footer-save', disabled: unavailable(status),
        title: t(unavailable(status) ? 'saveUnavailable' : 'saveHint') })));
  }

  function render() {
    if (!state) return;
    const nextLanguage = language(state.locale);
    const langChange = nextLanguage !== locale || !root.dataset.locale;
    if (langChange) {
      locale = nextLanguage; t = words(locale); document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
      root.dataset.locale = locale; appTitle.textContent = document.title = t('app');
      dialogs.translate();
      if (toastMessage) toast.textContent = t(toastMessage.key, toastMessage.params);
    }
    if (!installedPrefs && state.phase !== 'booting') {
      installedPrefs = true;
      view.collapsed = Boolean(state.uiPreferences?.previewCollapsed);
    }
    if (state.uiPreferences && state.uiPreferences !== lastState.prefs) {
      if (state.uiPreferences.previewCollapsed != null) view.collapsed = state.uiPreferences.previewCollapsed;
    }
    inheritChrome();
    const status = statusOf(state, t);
    if (toastMessage?.key === 'restoredWindow' && state.live?.[toastMessage.params?.mode]?.sync === 'applied') {
      toastText('restoredConfirmed', 'success');
    }
    const projectUpdated = state.project !== lastState.project;
    const tabChanged = tab !== lastState.tab;
    const variantChanged = state.variant !== lastState.variant;
    const phaseChanged = state.phase !== lastState.phase;
    const key = JSON.stringify([status.text, status.sync, status.connection, status.recovery, status.live.canRecheck, pending(status),
      state.project?.name, state.variant, state.phase, view.statusHelp, state.live?.enabled]);
    if (key !== lastState.header || langChange) buildHeader(status);
    const bannerKey = JSON.stringify([status.connection, status.sync, status.active?.reason, status.active?.name,
      status.canBorrow, status.borrowed?.name, status.borrowed?.id, status.recovery, status.live.readError?.code, pending(status), view.statusHelp]);
    if (bannerKey !== lastState.banner || langChange) replace(banners, previewHelp(status), statusBanners(status));
    if (lastState.collapsed !== view.collapsed || langChange || !preview) buildPreview(langChange);
    else sampleUpdate();
    if (phaseChanged || langChange || tabChanged) buildTabs(langChange);
    const footKey = JSON.stringify([state.phase, status.connection, state.history, view.restoring]);
    if (footKey !== lastState.foot || langChange) buildFooter(status);
    const savedKey = JSON.stringify([state.library?.saved, state.library?.removed]), activeKey = JSON.stringify(state.host?.active?.[status.variant]);
    const matchKey = tab === 'matching' ? JSON.stringify(state.host?.matching ?? state.host?.tokens) : '';
    const navigationChanged = langChange || tabChanged || variantChanged || phaseChanged;
    // Keep the same input mounted between pointer clicks. Replacing it after
    // each native `change` also breaks double-click and repeated keyboard input.
    const inPlace = !needPage && !navigationChanged && sliderCommit?.tab === tab
      && sliderCommit.variant === state.variant && sliderCommit.project === state.project;
    sliderCommit = null;
    if (navigationChanged) dragging = false;
    if (!dragging && (needPage || (!inPlace && projectUpdated) || savedKey !== lastState.savedKey || navigationChanged
      || (tab === 'matching' && activeKey !== lastState.activeKey) || (tab === 'theme' && activeKey !== lastState.activeKey) || matchKey !== lastState.matchKey)) {
      needPage = false;
      const beforeScroll = main.scrollTop;
      const ctx = context();
      const focusBefore = main.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focusBefore?.dataset.focus;
      const selection = typeof focusBefore?.selectionStart === 'number'
        ? [focusBefore.selectionStart, focusBefore.selectionEnd, focusBefore.selectionDirection] : null;
      const body = !state.project || state.phase === 'booting'
        ? node('div', { class: 'loading-placeholder', role: 'status' }, icon('palette', 22), node('p', { text: t('booting') }))
        : tab === 'refine' ? refine.render(ctx) : pages[tab](ctx);
      replace(main, body);
      main.scrollTop = tabChanged ? savedScroll[tab] ?? 0 : beforeScroll;
      if (focusBefore && !tabChanged && document.activeElement === document.body) {
        recoverFocus(main, focusBefore, focusKey);
        if (document.activeElement === document.body && focusKey?.startsWith('picker:')) {
          focusKeys(main).find((el) => el.dataset.focus === `field:${refine.ui.target}`)?.focus({ preventScroll: true });
        }
      }
      // The controls that appear for a chosen style must not cover its own tile.
      if (tab === 'style' && focusKey?.startsWith('style:') && main.contains(document.activeElement)) {
        document.activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      if (!tabChanged && selection && document.activeElement.dataset.focus === focusKey &&
          typeof document.activeElement.setSelectionRange === 'function') document.activeElement.setSelectionRange(...selection);
      if (tab === 'refine' && view.focusPath) {
        const path = view.focusPath; view.focusPath = '';
        const field = focusKeys(main).find((el) => el.dataset.focus === `field:${path}`);
        if (field) {
          field.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
          field.focus({ preventScroll: true });
        }
      }
    } else if (inPlace && tab === 'tune') pages.refreshTuneAudit(main, context());
    reportNotice();
    if (!toast.hidden) placeToast();
    lastState = { banner: bannerKey, header: key, foot: footKey, tab, collapsed: view.collapsed, variant: state.variant, phase: state.phase,
      project: state.project, savedKey, activeKey, matchKey, prefs: state.uiPreferences };
  }

  function switchTab(key) {
    if (!TABS.includes(key)) return;
    if (tab !== key) savedScroll[tab] = main.scrollTop;
    tab = key;
    queue();
  }
  function jump(path) {
    if (!refine.focusAfter(context(), path)) return;
    if (tab !== 'refine') switchTab('refine');
    view.focusPath = path;
    refresh();
  }
  function showPref(patch) {
    if (Object.hasOwn(patch, 'previewCollapsed')) view.collapsed = patch.previewCollapsed;
    studio.setUiPreferences?.(patch);
    queue();
  }
  async function restoreOriginal() {
    if (view.restoring) return;
    view.restoring = true;
    queue();
    const earlier = state.notice?.id;
    try {
      const result = await studio.restoreOriginal();
      if (earlier === state.notice?.id) {
        if (result === true || result?.ok === true) {
          const mode = VARIANTS.find((variant) => result.variants?.[variant]?.observable) ?? state.host?.mode;
          const sync = state.live?.[mode]?.sync;
          if (result.observable && sync !== 'applied') toastText('restoredWindow', 'info', { mode });
          else toastText(result.observable ? 'restoredConfirmed' : 'restored', 'success');
        } else toastText('restoreFailed', 'warning');
      }
    } catch { toastText('restoreFailed', 'error'); }
    finally { view.restoring = false; queue(); }
  }
  async function recoverBuiltin(mode, id) {
    const result = await run(() => studio.recoverBuiltin(mode, id), { track: true, variant: mode });
    if (!result?.ok) return;
    if (result.observable && state.live?.[mode]?.sync !== 'applied') toastText('restoredWindow', 'info', { mode });
    else toastText(result.observable ? 'restoredConfirmed' : 'legacyPreviewCleared', 'success');
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) header.querySelector('.connection')?.focus({ preventScroll: true });
    });
  }

  function click(event) {
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
    const el = event.target.closest('[data-act]');
    if (!el) return;
    if (el.disabled) return;
    const action = el.dataset.act, id = el.dataset.id, value = el.dataset.value;
    if (menu?.contains(el)) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
    const s = state, ctx = context();
    const windowMode = s.host?.mode ?? s.variant;
    const fileAction = (fn) => run(() => fn(windowMode), { track: true, variant: windowMode });
    switch (action) {
      case 'tab': switchTab(id); break;
      case 'variant': if (value !== s.variant) studio.setVariant(value); break;
      case 'rename': rename?.focus(); break;
      case 'toggle-preview': showPref({ previewCollapsed: !view.collapsed }); break;
      case 'show-status-help': view.statusHelp = !view.statusHelp; queue(); break;
      case 'load-default': void run(() => studio.loadDefault()); break;
      case 'load-preset': studio.loadPreset(id); break;
      case 'load-current': void run(() => studio.loadCurrent?.()); break;
      case 'load-builtin': void run(() => studio.loadBuiltin(id)); break;
      case 'load-saved': void run(() => studio.loadSaved(id)); break;
      case 'manage-saved': {
        const card = s.library?.saved?.find((item) => item.id === id);
        if (card) dialogs.manageSaved(structuredClone(card));
        break;
      }
      case 'undo-remove-saved': void undoRemoveSaved(id); break;
      case 'toggle-builtins': pages.view.builtins = !pages.view.builtins; refresh(); break;
      case 'random': studio.randomize(); break;
      case 'image': pages.view.image = !pages.view.image; refresh(); break;
      case 'image-seed': {
        const candidate = pages.view.imageCandidates[Number(id)];
        if (candidate) { studio.seedFrom({ ...candidate, source: 'image' }); if (candidate.variant) studio.setVariant(candidate.variant); }
        break;
      }
      case 'style': studio.setStyle({ id: id || null, strength: pages.styleById.get(id)?.strength.default ?? 1, options: {} }); break;
      case 'tier': refine.setTier(value); refresh(); break;
      case 'preview-field': jump(el.dataset.path); break;
      case 'field': refine.open(el.dataset.path); refresh(); break;
      case 'field-group':
        if (refine.ui.groups.has(id)) refine.ui.groups.delete(id);
        else refine.ui.groups.add(id);
        refresh(); break;
      case 'refine-clear': refine.clear(); refresh(); requestAnimationFrame(() => main.querySelector('[data-input=search]')?.focus()); break;
      case 'clear-group': studio.clearOverrides(id); break;
      case 'clear-all': studio.clearOverrides(); break;
      case 'generate-seed':
        if (['background', 'accent', 'foreground'].some((key) => !isHex(pages.view.seed[key]))) toastText('badHex', 'warning');
        else studio.seedFrom({ ...Object.fromEntries(Object.entries(pages.view.seed).map(([key, value]) => [key, value.trim()])), variant: s.variant }); break;
      case 'reset-seed': pages.clearSeed(); refresh(); break;
      case 'counterpart': studio.makeCounterpart(id); break;
      case 'reset-tune':
        studio.setTune(id === 'all' ? { global: pages.tuneDefaults() } : { groups: { [id]: pages.tuneDefaults() } }, { phase: 'commit' }); break;
      case 'repair': pages.repair(ctx); refresh(); break;
      case 'undo': pages.view.repair = null; studio.undo(); break;
      case 'redo': pages.view.repair = null; studio.redo(); break;
      case 'restore': pages.view.repair = null; void restoreOriginal(); break;
      case 'recover-builtin': void recoverBuiltin(windowMode, id); break;
      case 'save': dialogs.file('save'); break;
      case 'export': dialogs.file('export'); break;
      case 'recheck-files': void fileAction((v) => studio.recheck(v)); break;
      case 'retry': void fileAction((v) => studio.retry(v)); break;
      case 'resolve-load':
      case 'resolve-overwrite': void fileAction((v) => studio.resolveConflict(v, action === 'resolve-load' ? 'load' : 'overwrite')); break;
      case 'copy-json': void copyJson(); break;
      case 'copy-text': void copyText(value); break;
      case 'import': dialogs.importDialog(); break;
      case 'cleanup': dialogs.cleanup(); break;
      case 'recovery-guide': dialogs.cleanup(true); break;
    }
  }
  function change(event) {
    const control = event.target, action = control.dataset.change;
    const { checked, value } = control;
    switch (action) {
      case 'live': studio.setLive(checked); break;
      case 'linked': studio.setLinked(checked); break;
      case 'only-fields': refine.ui.only = checked; refine.ui.target = ''; refresh(); break;
      case 'tune-group': pages.view.tuneGroup = value; refresh(); break;
      case 'protect-status': studio.setTune({ protectStatus: checked }); break;
      case 'protect-syntax': studio.setTune({ protectSyntax: checked }); break;
      case 'style-option': studio.setStyle({ options: { [control.dataset.id]: value } }); break;
    }
  }
  function keyboard(event) {
    if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary')?.focus(); return; }
    if (dialogs.isOpen) return;
    const target = event.target.closest('[role=tab]');
    if (target) {
      const i = TABS.indexOf(target.dataset.id);
      const movement = { ArrowLeft: (i + TABS.length - 1) % TABS.length, ArrowRight: (i + 1) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key];
      if (movement != null) {
        event.preventDefault();
        switchTab(TABS[movement]); navButtons[movement]?.focus();
      }
      return;
    }
    if (event.target.matches('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
      event.preventDefault();
      pages.view.repair = null;
      if (!view.restoring) {
        if (event.shiftKey || event.key.toLowerCase() === 'y') studio.redo();
        else studio.undo();
      }
    }
  }

  const events = new AbortController();
  const listen = (type, cb) => root.addEventListener(type, cb, { signal: events.signal });
  listen('click', (event) => {
    try { click(event); } catch { toastText('unknownError', 'error'); }
  });
  listen('change', (event) => { try { change(event); } catch { toastText('unknownError', 'error'); } });
  listen('input', (event) => { if (event.target.dataset.input === 'search') refine.refilter(context(), event.target.value); });
  listen('keydown', keyboard);
  listen('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  listen('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault(); if (!dialogs.isOpen && state.phase !== 'booting') dialogs.importDialog({ incoming: file });
  });
  const unsubscribe = studio.subscribe((next) => {
    state = next;
    if (gesturePhase === 'drag') {
      sampleUpdate();
      if (tab === 'refine') refine.lightUpdate(context());
    } else queue();
  });
  render();
  return { refresh, dispose() { events.abort(); unsubscribe?.(); if (frame) cancelAnimationFrame(frame); clearTimeout(toastTimer); refine.dispose(); dialogs.close(); } };
}
