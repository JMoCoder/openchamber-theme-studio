import { STYLE_RECIPES } from '../../shared/style-recipes.mjs';
import { adjustTheme, ADJUST_GROUPS, SYNTAX_STRATEGIES } from '../../shared/theme-derive.mjs';
import { button, heading, icon, node, optionList, toggle } from './dom.mjs';
import { auditSummary, colorToHex, get, IMAGE_LIMIT, isHex, localized, measurableColor, selectedCard, VARIANTS } from './model.mjs';
import { gesture, labeledRange } from './picker.mjs';
import { cardSwatches, themeCard, themeSwatches } from './preview.mjs';

const styleById = new Map(STYLE_RECIPES.map((style) => [style.id, style]));
const matchKeys = ['uiFont', 'monoFont', 'uiFontWeight', 'fontSize', 'padding', 'chatWidth', 'layoutAnimations'];
const fonts = {
  system: 'system-ui', inter: 'Inter', fixel: 'Fixel', 'geist-sans': 'Geist', 'atkinson-hyperlegible': 'Atkinson Hyperlegible',
  'source-sans-3': 'Source Sans 3', roboto: 'Roboto', 'noto-sans': 'Noto Sans', 'dm-sans': 'DM Sans', manrope: 'Manrope',
  'system-mono': 'monospace', 'jetbrains-mono': 'JetBrains Mono', 'fira-code': 'Fira Code', 'geist-mono': 'Geist Mono',
  'commit-mono': 'Commit Mono', 'source-code-pro': 'Source Code Pro', 'cascadia-code': 'Cascadia Code',
  'roboto-mono': 'Roboto Mono', iosevka: 'Iosevka',
};
const groups = {
  canvas: { zh: '画布与表面', en: 'Canvas and surfaces' }, text: { zh: '正文与辅助字', en: 'Text' },
  accent: { zh: '强调色', en: 'Accents' }, interaction: { zh: '交互与边线', en: 'Interaction' },
  syntax: { zh: '代码色', en: 'Code' }, status: { zh: '状态色', en: 'Status' }, details: { zh: '聊天与细节', en: 'Chat and details' },
};
const syntax = {
  balanced: { zh: '均衡', en: 'Balanced' }, analogous: { zh: '近似色', en: 'Related hues' }, duotone: { zh: '双主色', en: 'Two dominant hues' },
};
const seeds = {
  background: { zh: '底色', en: 'Canvas' }, accent: { zh: '强调色', en: 'Accent' }, foreground: { zh: '文字色', en: 'Text' },
};
const knobs = [['hue', -180, 180, 1], ...['chroma', 'lightness', 'contrast', 'temperature'].map((key) => [key, -1, 1, .01])];
const fieldLimit = (text) => String(text ?? '').trim().slice(0, 100);

const swatchPair = (card) => Object.fromEntries(VARIANTS.map((v) => [v, cardSwatches(card, v)]));
const themeName = (card, locale) => localized(card.name ?? card.label ?? card.metadata?.name, locale, card.id ?? card.slug);
const firstFont = (stack) => String(stack ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
const monos = new Set(['monospace', 'ui-monospace']);
const generics = new Set(['system-ui', 'monospace', 'ui-monospace', 'sans-serif', 'serif', 'ui-serif', 'ui-sans-serif']);
const sampleFont = (value, mono) => {
  const name = fieldLimit(value);
  return generics.has(name.toLowerCase()) ? name : `"${name.replace(/["\\\n\r]/g, '')}", ${mono ? 'monospace' : 'system-ui'}`;
};

function styleStudy(definition, recipe, options, tune, overrides, isField) {
  let draft = recipe ? recipe.apply(definition, { ...options, strength: 1 }).definition : definition;
  const protection = { protectStatus: tune?.protectStatus, protectSyntax: tune?.protectSyntax };
  if (tune?.global) draft = adjustTheme(draft, { ...tune.global, ...protection }).definition;
  for (const [group, patch] of Object.entries(tune?.groups ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    draft = adjustTheme(draft, { ...patch, group, ...protection }).definition;
  }
  const entries = Object.entries(overrides ?? {});
  if (!entries.length) return draft;
  draft = structuredClone(draft);
  for (const [path, value] of entries) {
    if (!isField(path)) continue;
    const parts = path.split('.'), key = parts.pop();
    const target = parts.reduce((n, part) => n[part] ??= {}, draft);
    target[key] = value;
  }
  return draft;
}

function cardId(card) { return card.id ?? card.slug ?? card.metadata?.id; }
function matchesId(card, id) {
  return id && (cardId(card) === id || card.ids?.includes(id) || Object.values(card.variants ?? {}).some((part) => part?.id === id));
}
export function currentEntry(state, studio) {
  // The window's own mode says what is in use; the tab may be editing the other version.
  const current = state.host?.active?.[state.host?.mode ?? state.variant];
  if (!current || !current.id || current.kind === 'unknown') return null;
  if (current.kind === 'tryon') return typeof studio.loadCurrent === 'function' ? { ...current, action: 'load-current' } : null;
  const builtin = state.library?.builtins?.find((card) => matchesId(card, current.id));
  const saved = state.library?.saved?.find((card) => matchesId(card, current.id));
  if (builtin) return { ...current, action: 'load-builtin', id: cardId(builtin) };
  if (saved) return { ...current, action: 'load-saved', id: cardId(saved) };
  if (current.kind !== 'custom' && typeof studio.loadCurrent === 'function') return { ...current, action: 'load-current' };
  return null;
}

function localColors(file) {
  return (async () => {
    if (!file || file.size > IMAGE_LIMIT || !/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Unsupported image');
    const image = await createImageBitmap(file, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'low' });
    try {
      const canvas = node('canvas', { width: image.width, height: image.height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } finally { image.close(); }
  })();
}

function nameFont(value, settings = {}) {
  if (value === 'custom') return settings.customUiFont ?? settings.customMonoFont ?? '';
  return fonts[value] ?? firstFont(value);
}

export function fontStatus(family) {
  if (generics.has(family.toLowerCase())) return 'fontGeneric';
  if (!family) return 'fontUnknown';
  const canvas = node('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) return 'fontUnknown';
  const sample = 'iiii MMMM WWWW Alphabet 0123456789';
  const measure = (value) => { ctx.font = `28px ${value}`; return ctx.measureText(sample).width; };
  const css = sampleFont(family, false).split(', system-ui')[0];
  const ser = measure(`${css}, serif`), mono = measure(`${css}, monospace`);
  return Math.abs(ser - mono) < .05 && (Math.abs(ser - measure('serif')) > .05 || Math.abs(mono - measure('monospace')) > .05) ? 'fontDetected' : 'fontUnknown';
}

export function createPages() {
  const view = {
    builtins: false, showRemoved: false, image: false, imageCandidates: [], imagePending: false, imageError: null,
    tuneGroup: 'canvas', seed: {}, seedKey: '', repair: null, auditExpanded: false, font: {}, stateStyleKey: '', styleTiles: new Map(),
  };
  const libraryCards = (ctx, cards, action) => {
    const { t, locale, state } = ctx;
    return cards.map((card) => {
      const id = action === 'load-preset' ? card.slug ?? cardId(card) : cardId(card);
      const name = themeName(card, locale);
      const tile = themeCard(t, { id, label: name, detail: localized(card.description, locale),
        action, colors: swatchPair(card), selected: selectedCard(state.project, card) });
      return action === 'load-saved' ? node('div', { class: 'saved-card' }, tile,
        button(t('manageSaved', { name }), { action: 'manage-saved', 'data-id': id, 'data-focus': `manage-saved:${id}`,
          glyph: 'trash', kind: 'u-mini saved-manage', iconOnly: true })) : tile;
    });
  };
  const byLibrary = (ctx, cards, action, kind) => node('div', { class: `theme-grid ${kind}` }, libraryCards(ctx, cards, action));
  function removedThemes(ctx) {
    const { t, state, undoingSaved } = ctx;
    const cards = state.library?.removed ?? [];
    if (!cards.length) return null;
    const details = node('details', { class: 'saved-removed', open: view.showRemoved,
      ontoggle(event) { if (event.currentTarget.isConnected) view.showRemoved = event.currentTarget.open; } },
    node('summary', { 'data-focus': 'saved:removed' }, icon('chevron', 14), node('span', { text: t('removedThemes') }),
      node('span', { class: 'u-muted removed-count', text: cards.length })),
    node('ul', {}, cards.map((card) => node('li', {}, node('span', { class: 'removed-name', text: card.name }),
      button(t('undoRemove'), { action: 'undo-remove-saved', 'data-id': card.id, 'data-focus': `saved:undo:${card.id}`,
        'aria-label': t('undoRemoveName', { name: card.name }), kind: 'u-link', disabled: undoingSaved.has(card.id) })))));
    return details;
  }

  function theme(ctx) {
    const { t, state } = ctx;
    const studio = ctx.studio;
    const current = currentEntry(state, studio);
    const imageInput = node('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'visually-hidden', id: 'image-file',
      tabindex: -1, onchange: (event) => { chooseImage(ctx, event.target.files[0]); event.target.value = ''; } });
    const available = state.library?.presets ?? [];
    const builtins = state.library?.builtins ?? [];
    const native = builtins.find((card) => cardId(card) === 'openchamber');
    return node('div', { class: 'tab-content theme-page' },
      node('section', {},
        heading(t('presets'), null),
        node('div', { class: 'theme-grid preset-cards' },
          themeCard(t, { id: 'openchamber', label: t('defaultTheme'), detail: t('defaultHint'), action: 'load-default',
            colors: native ? swatchPair(native) : undefined,
             selected: state.project.origin?.kind === 'default' }),
          libraryCards(ctx, available, 'load-preset'))),
      current && node('div', { class: 'list-actions' },
        button(t('current'), { class: 'list-action', action: current.action, 'data-id': current.id, 'data-focus': 'theme:current' },
          icon('link'), node('span', { class: 'u-muted list-side', text: current.name }), icon('chevron', 15))),
      node('section', { class: 'theme-saved' }, heading(t('yourThemes'), null),
        state.library?.saved?.length ? byLibrary(ctx, state.library.saved, 'load-saved', 'saved-cards')
          : node('p', { class: 'empty-note u-muted', text: t('savedEmpty') }), removedThemes(ctx)),
      node('section', { class: 'theme-sources' }, heading(t('sources'), null),
        node('div', { class: 'list-actions' },
          button(t('builtin'), { class: 'list-action', action: 'toggle-builtins', 'data-focus': 'builtins', 'aria-expanded': String(view.builtins) },
            icon('layers'), node('span', { class: 'u-muted list-side', text: state.library?.builtins?.length || '' }), icon(view.builtins ? 'down' : 'chevron', 15)),
          view.builtins && (builtins.length ? byLibrary(ctx, builtins, 'load-builtin', 'builtin-cards') : node('p', { class: 'empty-note', text: t('builtinEmpty') })),
          button(t('image'), { class: 'list-action', action: 'image', 'data-focus': 'image', 'aria-expanded': String(view.image) }, icon('image'), icon(view.image ? 'down' : 'chevron', 15)),
          view.image && node('div', { class: 'image-work' }, node('p', { class: 'u-muted', text: t('imageHint') }),
            button(t('imagePick'), { kind: 'u-secondary', glyph: 'image', onclick: () => imageInput.click(), 'data-focus': 'image-file' }), imageInput,
            view.imagePending && node('p', { role: 'status', text: t('loading') }),
            view.imageError && node('p', { class: 'issue-inline', role: 'status', text: t(view.imageError) }),
            view.imageCandidates.length > 0 && node('div', { class: 'image-candidates' }, node('h3', { text: t('imageCandidates') }),
              view.imageCandidates.map((c, i) => node('button', { type: 'button', class: 'image-palette', 'data-act': 'image-seed', 'data-id': i,
                'data-focus': `image-seed:${i}`, 'aria-label': `${t(c.variant ?? state.variant)}: ${c.background}, ${c.accent}` },
              [c.background, c.accent, c.foreground].filter(Boolean).map((value) => node('span', { title: value, style: { '--ink': value } })))))),
          button(t('random'), { class: 'list-action', action: 'random', 'data-focus': 'random' }, icon('shuffle'), icon('chevron', 15)),
          button(t('import'), { class: 'list-action', action: 'import', 'data-focus': 'import' }, icon('upload'), icon('chevron', 15)))));
  }

  async function chooseImage(ctx, file) {
    if (!file) return;
    view.imagePending = true; view.imageError = null; view.imageCandidates = []; ctx.refresh();
    try {
      const pixels = await localColors(file);
      view.imageCandidates = await ctx.studio.seedFromPixels(pixels);
      if (!view.imageCandidates?.length) view.imageError = 'imageEmpty';
    } catch { view.imageError = 'imageError'; }
    finally { view.imagePending = false; ctx.refresh(); }
  }

  function style(ctx) {
    const { state: s, t, locale, studio } = ctx;
    const v = s.variant, co = s.project.style[v];
    const original = s.project.base[v];
    const currentTune = s.project.tune[v], overrides = s.project.overrides[v];
    const baseKey = JSON.stringify([v, original, currentTune, overrides]);
    if (baseKey !== view.stateStyleKey) {
      view.stateStyleKey = baseKey; view.styleTiles.clear();
    }
    const colorFor = (recipe) => {
      const current = recipe?.id && recipe.id === co.id;
      const key = current ? `${recipe.id}:${JSON.stringify(co.options)}` : recipe?.id ?? 'no-style';
      if (!view.styleTiles.has(key)) {
        try { view.styleTiles.set(key, themeSwatches(styleStudy(original, recipe, current ? co.options : {}, currentTune, overrides, ctx.refine.isVisible))); }
        catch { view.styleTiles.set(key, null); }
      }
      return view.styleTiles.get(key);
    };
    const chosen = styleById.get(co.id);
    const items = [null, ...STYLE_RECIPES];
    const full = (key, def, value, commit, label) => makeSlider(ctx, { key, value, def, commit, label, min: 0, max: 1, step: .01, percent: true });
    return node('div', { class: 'tab-content style-page' },
      heading(t('styles'), null),
      node('div', { class: 'style-grid' }, items.map((recipe) => {
        const name = localized(recipe?.name, locale, t('noStyle'));
        return themeCard(t, { id: recipe?.id ?? '', label: name, colors: { [v]: colorFor(recipe) }, variant: v, action: 'style',
          selected: (recipe?.id ?? null) === (co.id ?? null) });
      })),
      // Stays in reach at the bottom of the list, and never moves the tiles.
      chosen && node('section', { class: 'style-settings', 'aria-label': localized(chosen.name, locale) },
        full('strength', chosen.strength.default, co.strength, (value, phase) => studio.setStyle({ strength: value }, { phase }),
          `${t('strength')} · ${localized(chosen.name, locale)}`),
        chosen.options.map((opt) => node('label', { class: 'u-field' }, node('span', { text: localized(opt.label, locale) }),
          node('select', { 'data-change': 'style-option', 'data-id': opt.key, 'data-focus': `style:${opt.key}` },
            optionList(opt.choices.map((choice) => [choice.value, localized(choice.label, locale)]), co.options?.[opt.key] ?? opt.default))))));
  }

  function makeSlider(ctx, { key, group, min, max, step, value, def = 0, commit, percent, label }) {
    const { t } = ctx;
    const queued = gesture((v, phase) => ctx.changePhase(phase, () => commit(v, phase), true));
    const range = labeledRange({
      label: label ?? t(key), value: Number.isFinite(value) ? value : def, min, max, step, title: t('resetValue'),
      format: (v) => percent ? `${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${key === 'hue' ? `${v}°` : Math.round(v * 100)}`,
      attr: { 'data-focus': `slider:${group ?? ''}:${key}`, 'data-knob': key, 'data-knob-group': group ?? '' },
      onInput: queued.drag, onChange(v, blur) { if (!blur || queued.active) queued.finish(v); },
      onReset() { range.set(def); queued.finish(def); },
    });
    return range.root;
  }

  function tuneBlock(ctx, group, values) {
    return node('div', { class: 'tune-sliders' }, knobs.map(([key, min, max, step]) =>
      makeSlider(ctx, { key, group, min, max, step, value: values?.[key],
        commit(value, phase) {
          const patch = group === 'all' ? { global: { [key]: value } } : { groups: { [group]: { [key]: value } } };
          ctx.studio.setTune(patch, { phase });
        } })));
  }

  function readSeed(ctx) {
    const current = ctx.state.project.base[ctx.state.variant];
    const key = JSON.stringify(current?.colors);
    if (key === view.seedKey) return;
    view.seedKey = key;
    const colors = { background: get(current, 'colors.surface.background'), accent: get(current, 'colors.primary.base'), foreground: get(current, 'colors.surface.foreground') };
    view.seed = Object.fromEntries(Object.entries(colors).map(([k, color]) => {
      const rgba = measurableColor(color, ctx.convert);
      return [k, rgba ? colorToHex(rgba) : color ?? ''];
    }));
    view.seed.syntaxStrategy = 'balanced';
  }

  function seedEditor(ctx) {
    const { t, locale } = ctx;
    readSeed(ctx);
    return node('section', { class: 'tune-seeds' }, heading(t('seed'), t('seedHint')),
      node('div', { class: 'seed-grid' }, Object.entries(seeds).map(([key, label]) => {
        const native = node('input', { type: 'color', value: isHex(view.seed[key]) && view.seed[key].length === 7 ? view.seed[key] : '#777777',
          'aria-label': localized(label, locale), 'data-focus': `seed-pick:${key}` });
        const text = node('input', { type: 'text', value: view.seed[key], placeholder: '#3578d4', maxlength: 9, spellcheck: 'false', autocomplete: 'off',
          'aria-label': `${localized(label, locale)} HEX`, 'data-focus': `seeds:${key}` });
        native.addEventListener('input', () => { view.seed[key] = native.value; text.value = native.value; });
        text.addEventListener('input', () => {
          view.seed[key] = text.value;
          const value = text.value.trim();
          if (isHex(value) && value.length === 7) native.value = value;
        });
        return node('div', { class: 'u-field' }, node('span', { text: localized(label, locale) }), node('div', { class: 'seed-color-input' }, native, text));
      })),
      node('div', { class: 'seed-actions' }, node('label', { class: 'u-field' }, node('span', { text: t('codeColors') }),
        node('select', { 'data-focus': 'seed-syntax', onchange(event) { view.seed.syntaxStrategy = event.target.value; } },
          optionList(SYNTAX_STRATEGIES.map((id) => [id, localized(syntax[id], locale)]), view.seed.syntaxStrategy))),
      button(t('seedMake'), { action: 'generate-seed', glyph: 'sparkle', kind: 'u-secondary', 'data-focus': 'seed-generate' }),
      button(t('seedReset'), { action: 'reset-seed', glyph: 'reset', iconOnly: true, kind: 'u-icon' })));
  }

  function audit(ctx) {
    const { state, t, labelFor, locale } = ctx;
    const audit = auditSummary(state.audit?.[state.variant]);
    const regularMinimum = (x) => x?.minimum != null && x.minimum >= 3 && typeof x.actual === 'number' && x.actual >= 0;
    const reasons = (x) => ({
      layer: locale === 'zh' ? '面层不易分辨' : 'Surfaces look too similar',
      'soft-border': locale === 'zh' ? '边界不易分辨' : 'Border blends into the canvas',
      'status-hue': locale === 'zh' ? '状态色不易辨认' : 'Status color is hard to recognize',
      'status-accent': locale === 'zh' ? '与强调色太接近' : 'Too close to the accent',
      'syntax-separation': locale === 'zh' ? '代码色过于接近' : 'Syntax colors look too similar',
      'diff-cvd': locale === 'zh' ? '部分色觉下改动难分辨' : 'Changes may be hard to distinguish',
      'hex-only': t('auditUnknown'), 'not-computable': t('unknownRatio'), 'alpha-dropped': t('auditUnknown'),
    })[x.code] ?? (regularMinimum(x) ? t('ratioBoth', { ratio: x.actual.toFixed(2), min: x.minimum }) : t('issues'));
    const results = view.repair?.variant === state.variant ? view.repair : null;
    const detail = results && (results.before != null && results.after != null && results.before !== results.after
      ? t('repairResult', { before: results.before, after: results.after })
      : results.changes ? t('repairLimited') : t('repairUnchanged'));
    return node('section', { class: 'tune-audit' }, heading(t('audit'), t('auditHint')),
      audit ? node('div', { class: `audit-band ${audit.score != null && audit.score < 85 ? 'needs-review' : ''}` },
        node('div', { class: 'audit-metric' }, node('strong', { text: audit.score ?? '—' }), node('span', { text: '/100' })),
        node('div', { class: 'audit-meta' }, node('span', { text: t('checks', { pass: audit.pass, total: audit.total }) }),
          audit.unknown > 0 && node('small', { class: 'u-muted', text: t('auditUnknown') })),
        button(t('repair'), { action: 'repair', kind: 'u-secondary', glyph: 'shield', 'data-focus': 'repair' }),
      ) : node('p', { class: 'empty-note u-muted', text: t('pendingAudit') }),
      detail && node('div', { class: 'repair-compare', role: 'status' }, node('p', { text: detail }),
        results.beforeColors && results.afterColors && node('div', { class: 'repair-pair' },
          [[t('repairBefore'), results.beforeColors], [t('repairAfter'), results.afterColors]].map(([label, colors]) =>
            node('div', {}, node('span', { class: 'u-muted', text: label }),
              node('span', { class: 'mini-palette' }, [colors.canvas, colors.primary, colors.foreground, ...(colors.syntax ?? [])].map((value) =>
                node('i', { style: { '--ink': value } }))))))),
      audit?.failing?.length > 0
         ? node('details', { class: 'audit-issues', open: view.auditExpanded,
           ontoggle(event) { if (event.currentTarget.isConnected) view.auditExpanded = event.currentTarget.open; } },
           node('summary', { text: `${t('issues')} · ${audit.failing.length}`, 'data-focus': 'audit:issues' }),
          node('div', { class: 'audit-issue-list' }, audit.failing.map((x) => node('div', { class: 'audit-issue' },
            ctx.refine.isVisible(x.path)
              ? button(labelFor(x.path), { action: 'preview-field', 'data-path': x.path, kind: 'u-link' })
              : node('span', { class: 'u-muted', text: t('unknownRatio') }),
            node('span', { class: 'u-muted', text: reasons(x) })))))
        : audit && node('p', { class: 'u-muted empty-note', text: t('issuesEmpty') }));
  }

  function tune(ctx) {
    const { t, locale, state: s } = ctx;
    const tune = s.project.tune[s.variant];
    return node('div', { class: 'tab-content tune-page' },
      node('div', { class: 'tune-top' }, seedEditor(ctx),
        node('section', { class: 'tune-pair' }, heading(t('pair'), t('pairHint')),
          toggle(t('linked'), { act: 'linked', checked: s.project.linked }),
          node('div', { class: 'form-actions' }, VARIANTS.map((v) => button(t(v === 'light' ? 'makeLight' : 'makeDark'), {
            action: 'counterpart', 'data-id': v, 'data-focus': `counterpart:${v}`, glyph: v === 'light' ? 'sun' : 'moon', kind: 'u-secondary' }))))),
      node('div', { class: 'tune-middle' },
        node('section', {}, heading(t('globalTune'), null,
          button(t('resetTune'), { action: 'reset-tune', 'data-id': 'all', glyph: 'reset', iconOnly: true, kind: 'u-mini' })),
        tuneBlock(ctx, 'all', tune?.global ?? tune)),
        node('section', {}, heading(t('groupTune'), null,
          button(t('resetTune'), { action: 'reset-tune', 'data-id': view.tuneGroup, glyph: 'reset', iconOnly: true, kind: 'u-mini' })),
        node('label', { class: 'u-field tune-group' }, node('span', { text: t('area') }),
          node('select', { 'data-change': 'tune-group', 'data-focus': 'tune-group' },
            optionList(ADJUST_GROUPS.filter((g) => g !== 'all').map((g) => [g, localized(groups[g], locale, g)]), view.tuneGroup))),
        tuneBlock(ctx, view.tuneGroup, tune?.groups?.[view.tuneGroup]))),
      node('div', { class: 'tune-protection' }, toggle(t('protectStatus'), { checked: tune?.protectStatus !== false, act: 'protect-status' }),
        toggle(t('protectSyntax'), { checked: tune?.protectSyntax !== false, act: 'protect-syntax' })),
      audit(ctx));
  }

  function settingDisplay(t, key, value, settings) {
    if (value == null || value === '') return '';
    if (key === 'uiFont') return nameFont(value, { customUiFont: settings?.customUiFont });
    if (key === 'monoFont') return nameFont(value, { customMonoFont: settings?.customMonoFont });
    if (typeof value === 'boolean') return t(value ? 'on' : 'off');
    if (typeof value === 'number' && ['padding', 'fontSize'].includes(key)) return `${value}%`;
    if (['default', 'wider', 'full', 'strong', 'regular', 'balanced'].includes(value)) return t(value);
    return String(value);
  }

  function matching(ctx) {
    const { state: s, t } = ctx;
    const co = s.project.style[s.variant];
    const styleSettings = styleById.get(co.id)?.settings ?? {};
    const origin = s.library?.presets?.find((p) => p.slug === s.project.origin?.ref);
    const presetFont = origin?.style?.fonts;
    const matching = {
      uiFont: presetFont?.sans?.[0] ?? 'system', monoFont: presetFont?.mono?.[0] ?? 'system-mono',
      uiFontWeight: 'regular', fontSize: 100, padding: 100, chatWidth: 'default', layoutAnimations: true,
      ...s.project.matching, ...styleSettings,
    };
    const tokens = s.host?.tokens;
    const current = { uiFont: tokens?.font, monoFont: tokens?.mono, fontSize: tokens?.fontSize, ...s.host?.matching };
    function tryFont(key) {
      const mono = key === 'monoFont';
      const preferred = settingDisplay(t, key, matching[key], matching);
      const available = mono ? ['monospace', ...Object.entries(fonts).slice(11).map(([, name]) => name)] : Object.values(fonts).slice(0, 10);
      const input = node('input', { type: 'text', list: `font-${key}`, 'aria-label': `${t('fontTest')}: ${t(key)}`, 'data-focus': `font:${key}`,
        value: view.font[key] ?? preferred, maxlength: 100, autocomplete: 'off', placeholder: t('customFamily') });
      const sample = node('p', { class: `font-sample${mono ? ' mono' : ''}`, text: t(mono ? 'monoExample' : 'fontExample') });
      const detected = node('p', { class: 'u-muted font-status' });
      const test = () => {
        const family = firstFont(fieldLimit(input.value));
        sample.style.fontFamily = sampleFont(family || (mono ? 'monospace' : 'system-ui'), mono);
        detected.textContent = t(fontStatus(family));
      };
      input.addEventListener('input', () => { view.font[key] = input.value; test(); });
      test();
      return node('div', { class: 'font-try' },
        node('label', { class: 'u-field' }, node('span', { text: t(key) }), input),
        node('datalist', { id: `font-${key}` }, [...new Set(available)].filter((name) => !mono || monos.has(name) || !generics.has(name)).map((name) => node('option', { value: name }))),
        sample, detected);
    }
    return node('div', { class: 'tab-content matching-page' }, heading(t('matching'), null),
      node('div', { class: 'match-guide' }, icon('corner'), t('matchPath')),
      node('div', { class: 'matching-table', role: 'table', 'aria-label': t('matching') },
        node('div', { class: 'match-row match-columns', role: 'row' },
          ['setting', 'recommended', 'now', 'copy'].map((k) => node('span', { role: 'columnheader', text: t(k) }))),
      matchKeys.map((key) => {
        const value = settingDisplay(t, key, matching[key], matching);
        const actual = settingDisplay(t, key, current[key], current);
        return node('div', { class: 'match-row', role: 'row' },
          node('h3', { role: 'rowheader', text: t(key) }),
          node('div', { class: 'match-pair', role: 'cell' }, node('span', { text: t('recommended'), class: 'u-muted' }), node('span', { text: value })),
          node('div', { class: 'match-pair', role: 'cell' }, node('span', { text: t('now'), class: 'u-muted' }), node('span', { text: actual || t('notVisible'), class: actual ? '' : 'u-muted' })),
          node('div', { role: 'cell' }, button(t('copyValue', { value: `${t(key)}: ${value}` }), { action: 'copy-text', 'data-value': value, glyph: 'copy', iconOnly: true, kind: 'u-mini', disabled: !value })));
      })),
      node('section', { class: 'matching-fonts' }, heading(t('fontTest'), null), node('div', { class: 'font-grid' }, ['uiFont', 'monoFont'].map(tryFont))));
  }
  return {
    theme, style, tune, matching, view, styleById,
    clearSeed() { view.seedKey = ''; },
    repair(ctx) {
      const { state: s, studio } = ctx, v = s.variant;
      const before = s.audit?.[v]?.score;
      const beforeColors = themeSwatches(s.resolved?.[v]);
      const result = studio.repair(v);
      const afterState = studio.getState();
      view.repair = { variant: v, before: result?.before?.score ?? before, after: result?.after?.score ?? afterState.audit?.[v]?.score,
        changes: result?.changes?.length ?? 0, beforeColors, afterColors: themeSwatches(afterState.resolved?.[v]) };
    },
    refreshTuneAudit(region, ctx) {
      const previous = region.querySelector('.tune-audit');
      if (!previous) return;
      const panel = audit(ctx), disclosure = panel.querySelector('details');
      if (disclosure) disclosure.open = Boolean(previous.querySelector('details[open]'));
      previous.replaceWith(panel);
    },
    tuneDefaults() { return Object.fromEntries(knobs.map(([key]) => [key, 0])); },
  };
}
