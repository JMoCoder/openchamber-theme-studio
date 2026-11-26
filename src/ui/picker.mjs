import { button, node } from './dom.mjs';
import { clamp, colorToHex, contrastForField, fromHsv, isHex, isSafeColor, measurableColor, toHsv } from './model.mjs';

/** The browser resolves standalone advanced colors; the editor retains the source string. */
export function makeColorConverter() {
  let ctx;
  const cache = new Map();
  return (value) => {
    if (cache.has(value)) return cache.get(value);
    ctx ??= node('canvas', { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // A sentinel guards contexts that accept CSS.supports() but reject a Canvas fill.
    ctx.fillStyle = '#000001'; ctx.fillStyle = value;
    if (ctx.fillStyle === '#000001') {
      ctx.fillStyle = '#fffffe'; ctx.fillStyle = value;
      if (ctx.fillStyle === '#fffffe') return null;
    }
    ctx.globalCompositeOperation = 'copy';
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const result = { r, g, b, a: a / 255 };
    if (cache.size > 190) cache.clear();
    cache.set(value, result);
    return result;
  };
}

/** Collapse all queued native pointer input to the last value before paint. */
export function gesture(commit) {
  let frame = 0, value, active = false;
  return {
    drag(next) {
      value = next;
      active = true;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        commit(value, 'drag');
      });
    },
    finish(next = value) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0; active = false;
      commit(next, 'commit');
    },
    cancel() { if (frame) cancelAnimationFrame(frame); frame = 0; active = false; },
    get active() { return active; },
  };
}

export function labeledRange({ label, min, max, step, value, format = String, className = '', title, onInput, onChange, onReset, attr = {} }) {
  const output = node('output', { class: 'range-value', text: format(value) });
  const set = (v) => {
    if (Number(input.value) !== v) input.value = v;
    const displayed = format(v);
    if (output.textContent !== displayed) output.textContent = displayed;
    if (input.getAttribute('aria-valuetext') !== displayed) input.setAttribute('aria-valuetext', displayed);
    input.style.setProperty('--range-fill', `${(v - min) / (max - min) * 100}%`);
  };
  const input = node('input', { type: 'range', min, max, step, value, title, 'aria-label': label, ...attr, oninput() {
    const v = Number(input.value); set(v); onInput?.(v);
  }, onchange() { onChange?.(Number(input.value)); }, onblur() {
    // Mouse release outside a detached frame may not deliver a change.
    onChange?.(Number(input.value), true);
  }, ondblclick(event) { if (onReset) { event.preventDefault(); onReset(); } } });
  const caption = node('span', { text: label });
  const root = node('label', { class: `range-control ${className}` }, node('span', { class: 'range-label' }, caption, output), input);
  set(value);
  return { root, input, set, relabel(value) { caption.textContent = value; input.setAttribute('aria-label', value); } };
}

export function colorSwatch(value, props = {}) {
  return node('span', { class: 'color-swatch alpha-grid', ...props },
    node('span', { class: 'color-ink', style: isSafeColor(value) ? { '--ink': value } : {} }));
}

export function createColorPicker(context) {
  let ctx = context;
  let { t } = ctx;
  const { field, convert } = ctx;
  let hsv = toHsv(measurableColor(ctx.value, convert) ?? { r: 128, g: 128, b: 128, a: 1 });
  let owner = false, pointer = null, surfaceRect, lastValue, errorKey;
  const rangeCommit = gesture((value, phase) => {
    owner = true;
    ctx.onColor(value, phase);
    owner = false;
  });
  const hexInput = node('input', { type: 'text', maxlength: 9, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    'data-picker-hex': true, 'data-focus': 'picker:hex', 'aria-label': t('hex'), value: '', placeholder: '#3578d4' });
  const cssInput = node('input', { type: 'text', maxlength: 250, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    'data-picker-css': true, 'data-focus': 'picker:css', 'aria-label': t('css'), value: '', placeholder: 'oklch(62% 0.15 245)' });
  const error = node('p', { class: 'picker-error', role: 'status', hidden: true });
  const hexCaption = node('span', { text: t('hex') }), cssCaption = node('span', { text: t('css') });
  const hexLabel = node('label', { class: 'u-field' }, hexCaption, hexInput);
  const cssLabel = node('label', { class: 'u-field' }, cssCaption, cssInput);
  const selected = colorSwatch(ctx.value, { class: 'color-swatch alpha-grid picker-selected', 'aria-hidden': 'true' });
  const handle = node('i', { class: 'picker-cursor', 'aria-hidden': 'true' });
  const surface = node('div', { class: 'picker-surface', 'aria-hidden': 'true', 'data-picker-surface': true }, handle);
  const ratioList = node('div', { class: 'picker-ratios' });
  const recent = node('div', { class: 'picker-swatches' });
  const current = node('div', { class: 'picker-swatches' });
  const follow = button(t('follow'), { kind: 'u-secondary', glyph: 'reset', 'data-focus': 'picker:follow', onclick: () => { clearError(); ctx.onFollow(); } });

  function clearError() {
    errorKey = null;
    error.hidden = true;
    hexInput.removeAttribute('aria-invalid');
    cssInput.removeAttribute('aria-invalid');
  }
  function showError(key) { errorKey = key; error.textContent = t(key); error.hidden = false; }
  function tryText(input, type) {
    const value = input.value.trim();
    if (!value || !(type === 'hex' ? isHex(value) : isSafeColor(value))) {
      clearError();
      input.setAttribute('aria-invalid', 'true');
      showError(type === 'hex' ? 'badHex' : 'badCss');
      return;
    }
    clearError();
    ctx.onColor(value, 'commit');
  }
  for (const [input, type] of [[hexInput, 'hex'], [cssInput, 'css']]) {
    input.addEventListener('input', clearError);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
      event.preventDefault(); tryText(input, type);
    });
  }

  const formatPercent = (v) => `${v}%`;
  const formatHue = (v) => `${v}°`;
  function sendHsv(patch, phase, blur) {
    if (blur && !rangeCommit.active) return;
    clearError();
    hsv = { ...hsv, ...patch };
    const value = colorToHex(fromHsv(hsv));
    adjustVisuals(value, true);
    if (phase === 'drag') rangeCommit.drag(value);
    else rangeCommit.finish(value);
  }
  const hue = labeledRange({ label: t('hue'), min: 0, max: 359, step: 1, value: Math.round(hsv.h), format: formatHue, className: 'picker-hue',
    attr: { 'data-picker-hue': true, 'data-focus': 'picker:hue' }, onInput: (v) => sendHsv({ h: v }, 'drag'), onChange: (v, blur) => sendHsv({ h: v }, 'commit', blur) });
  const alpha = labeledRange({ label: t('alpha'), min: 0, max: 100, step: 1, value: Math.round(hsv.a * 100), format: formatPercent, className: 'picker-alpha',
    attr: { 'data-picker-alpha': true, 'data-focus': 'picker:alpha' }, onInput: (v) => sendHsv({ a: v / 100 }, 'drag'), onChange: (v, blur) => sendHsv({ a: v / 100 }, 'commit', blur) });
  const saturation = labeledRange({ label: t('saturation'), min: 0, max: 100, step: 1, value: Math.round(hsv.s * 100), format: formatPercent,
    attr: { 'data-focus': 'picker:saturation' }, onInput: (v) => sendHsv({ s: v / 100 }, 'drag'), onChange: (v, blur) => sendHsv({ s: v / 100 }, 'commit', blur) });
  const brightness = labeledRange({ label: t('brightness'), min: 0, max: 100, step: 1, value: Math.round(hsv.v * 100), format: formatPercent,
    attr: { 'data-focus': 'picker:brightness' }, onInput: (v) => sendHsv({ v: v / 100 }, 'drag'), onChange: (v, blur) => sendHsv({ v: v / 100 }, 'commit', blur) });
  function pad(event, phase) {
    if (pointer !== event.pointerId || !surfaceRect) return;
    sendHsv({ s: clamp((event.clientX - surfaceRect.left) / surfaceRect.width),
      v: 1 - clamp((event.clientY - surfaceRect.top) / surfaceRect.height) }, phase);
  }
  surface.addEventListener('pointerdown', (event) => {
    if (pointer !== null || event.button !== 0) return;
    event.preventDefault();
    surfaceRect = surface.getBoundingClientRect();
    surface.setPointerCapture(event.pointerId);
    pointer = event.pointerId;
    pad(event, 'drag');
  });
  surface.addEventListener('pointermove', (event) => pad(event, 'drag'));
  surface.addEventListener('pointerup', (event) => { pad(event, 'commit'); pointer = null; });
  for (const type of ['pointercancel', 'lostpointercapture']) surface.addEventListener(type, () => {
    if (pointer !== null && rangeCommit.active) rangeCommit.finish();
    pointer = null;
  });
  const screen = typeof globalThis.EyeDropper === 'function'
    ? button(t('eyeDropper'), { iconOnly: true, glyph: 'eyedrop', kind: 'u-icon', 'data-focus': 'picker:screen', onclick: async () => {
      try { const chosen = await new EyeDropper().open(); if (isHex(chosen.sRGBHex) && root.isConnected) ctx.onColor(chosen.sRGBHex, 'commit'); }
      catch (e) { if (e.name !== 'AbortError') showError('eyeUnavailable'); }
    } })
    : null;
  const swatchSection = (title, collection) => node('div', { class: 'picker-palette' }, title, collection);
  const caption = (key, tag = 'span') => node(tag, { text: t(key) });
  const axes = node('summary', { text: t('colorSurface'), 'data-focus': 'picker:axes' });
  const advanced = node('summary', { text: t('css'), 'data-focus': 'picker:advanced' });
  const cssHint = node('p', { class: 'u-muted', text: t('cssHint') });
  const paletteTitle = node('span', { class: 'picker-label', text: t('themeColors') });
  const recentTitle = node('span', { class: 'picker-label', text: t('recent') });
  const related = node('span', { class: 'picker-label', text: t('related') });
  const commitText = (input, type) => button(t('applyColor'), { iconOnly: true, glyph: 'check',
    'data-focus': `picker:commit:${type}`, onclick: () => tryText(input, type) });
  const hexCommit = commitText(hexInput, 'hex'), cssCommit = commitText(cssInput, 'css');
  const root = node('div', { class: 'color-picker', role: 'group', 'aria-label': `${t('picker')}: ${ctx.labelFor(field.path)}`, 'data-picker': true },
    node('div', { class: 'picker-work' }, surface, node('div', { class: 'picker-color-controls' },
      hue.root, alpha.root, node('details', { class: 'picker-axes' }, axes, saturation.root, brightness.root))),
    node('div', { class: 'picker-enter' }, selected, hexLabel, hexCommit, screen),
    error,
    node('details', { class: 'picker-advanced' }, advanced,
      node('div', { class: 'picker-enter' }, cssLabel, cssCommit), cssHint),
    node('div', { class: 'picker-palette-row' }, swatchSection(paletteTitle, current), swatchSection(recentTitle, recent)),
    node('div', { class: 'picker-bottom' },
      node('div', { class: 'picker-ratio-area' }, related, ratioList), follow));

  function adjustVisuals(value, fromOwn = false) {
    if (value !== lastValue || fromOwn) {
      lastValue = value;
      const measurable = measurableColor(value, convert);
      if (measurable && !fromOwn && !owner && pointer === null) hsv = toHsv(measurable, hsv.h);
      const svColor = `hsl(${hsv.h} 100% 50%)`;
      surface.style.setProperty('--surface-color', svColor);
      handle.style.setProperty('--x', `${hsv.s * 100}%`);
      handle.style.setProperty('--y', `${(1 - hsv.v) * 100}%`);
      alpha.input.style.setProperty('--alpha-ink', colorToHex({ ...fromHsv(hsv), a: 1 }));
      if (isSafeColor(value)) selected.firstElementChild.style.setProperty('--ink', value);
      hue.set(Math.min(359, Math.round(hsv.h))); alpha.set(Math.round(hsv.a * 100));
      saturation.set(Math.round(hsv.s * 100)); brightness.set(Math.round(hsv.v * 100));
      if (document.activeElement !== hexInput && hexInput.getAttribute('aria-invalid') !== 'true') hexInput.value = measurable ? colorToHex(measurable) : '';
      if (document.activeElement !== cssInput && cssInput.getAttribute('aria-invalid') !== 'true') cssInput.value = value ?? '';
    }
  }

  let oldPairKey, oldRecent, oldTheme;
  function renderPalette(element, colors) {
    element.replaceChildren(...colors.map((value) => node('button', {
      type: 'button', class: 'picker-chip', 'aria-label': t('useColor', { color: value }), title: value,
      'data-focus': `picker:swatch:${element === recent ? 'recent' : 'theme'}:${value}`,
      onclick: () => { clearError(); ctx.onColor(value, 'commit'); },
    }, colorSwatch(value))));
  }

  function translate(next) {
    t = next;
    root.setAttribute('aria-label', `${t('picker')}: ${ctx.labelFor(field.path)}`);
    for (const [element, key] of [[hexCaption, 'hex'], [cssCaption, 'css'], [axes, 'colorSurface'], [advanced, 'css'],
      [cssHint, 'cssHint'], [paletteTitle, 'themeColors'], [recentTitle, 'recent'], [related, 'related'],
      [follow.querySelector('.u-button-label'), 'follow']]) element.textContent = t(key);
    for (const [element, key] of [[hexInput, 'hex'], [cssInput, 'css'], [hexCommit, 'applyColor'], [cssCommit, 'applyColor'], [screen, 'eyeDropper']]) {
      if (!element) continue;
      element.setAttribute('aria-label', t(key));
      if (element.tagName === 'BUTTON') element.title = t(key);
    }
    for (const [range, key] of [[hue, 'hue'], [alpha, 'alpha'], [saturation, 'saturation'], [brightness, 'brightness']]) range.relabel(t(key));
    if (errorKey) error.textContent = t(errorKey);
    for (const collection of [recent, current]) {
      for (const swatch of collection.children) swatch.setAttribute('aria-label', t('useColor', { color: swatch.title }));
    }
    oldPairKey = undefined;
  }

  function update(next, { lightweight = false } = {}) {
    ctx = next;
    if (ctx.t !== t) translate(ctx.t);
    adjustVisuals(ctx.value);
    follow.disabled = !ctx.changed;
    if (!lightweight) {
      const r = ctx.recent.join(' '), p = ctx.palette.join(' ');
      if (r !== oldRecent) { oldRecent = r; renderPalette(recent, ctx.recent); recent.parentElement.hidden = !ctx.recent.length; }
      if (p !== oldTheme) { oldTheme = p; renderPalette(current, ctx.palette); }
    }
    const pairs = contrastForField(field, ctx.value, ctx.colorOf, ctx.canvas, ctx.variant, convert);
    const key = pairs.map(({ ratio }) => ratio?.toFixed(2) ?? '?').join('|');
    if (key !== oldPairKey) {
      oldPairKey = key;
      ratioList.replaceChildren(...(pairs.length ? pairs.map(({ path, minimum, ratio }) => node('div', { class: 'picker-ratio' },
        node('span', { text: ctx.labelFor(path) }), node('span', { class: `ratio-value ${ratio == null ? 'u-muted' : ratio >= minimum ? 'passes' : 'fails'}`,
          text: ratio == null ? t('unknownRatio') : t('ratioBoth', { ratio: ratio.toFixed(2), min: minimum }) })))
        : [node('span', { class: 'u-muted', text: t('noPairs') })]));
    }
  }
  update(ctx);
  return { root, update, dispose() { rangeCommit.cancel(); } };
}
