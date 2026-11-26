import { button, heading, icon, node, segment, toggle } from './dom.mjs';
import { colorSwatch, createColorPicker } from './picker.mjs';
import { get, isSafeColor, localized, TIERS, visibleFields } from './model.mjs';

const palettePaths = [
  'colors.primary.base', 'colors.surface.background', 'colors.surface.foreground', 'colors.surface.muted',
  'colors.interactive.selection', 'colors.status.success', 'colors.status.warning', 'colors.status.error',
  'colors.status.info', 'colors.syntax.base.keyword', 'colors.syntax.base.string',
];

export function createRefinement(catalog) {
  const fields = new Map(catalog.fields.map((field) => [field.path, field]));
  const groups = new Map(catalog.groups.map((group) => [group.id, group]));
  const ui = {
    query: '', tier: 'common', only: false, target: '', picker: null, pickerPath: '', pickerVariant: '',
    groups: new Set(['surfaces']), recent: [],
  };
  let rows = new Map(), searchBox, searchClear, searchBody, searchOptions, content;
  const labelFor = (path, locale) => localized(fields.get(path)?.label, locale, path);
  const isVisible = (path) => {
    const f = fields.get(path);
    return f?.type === 'color' && f.effect?.kind !== 'dead' && f.tier !== 'hidden' && !f.hidden;
  };

  function colorAt(s, path) {
    const f = fields.get(path);
    const v = s.variant;
    const css = f?.cssPreviewVar ? s.cssVars?.[v]?.[f.cssPreviewVar] : null;
    return get(s.resolved?.[v], path) ?? get(s.parsed?.[v], path) ?? css;
  }

  function pickerContext(ctx) {
    const field = fields.get(ui.target), { state: s, locale, t } = ctx;
    return {
      t, field, value: colorAt(s, field.path), changed: Object.hasOwn(s.project.overrides?.[s.variant] ?? {}, field.path),
      labelFor: (path) => labelFor(path, locale), canvas: colorAt(s, 'colors.surface.background'), variant: s.variant,
      convert: ctx.convert, colorOf: (path) => colorAt(s, path), recent: ui.recent,
      palette: [...new Set(palettePaths.map((path) => colorAt(s, path)).filter(isSafeColor))].slice(0, 10),
      onColor(value, phase) {
        if (phase === 'commit') ui.recent = [value, ...ui.recent.filter((old) => old !== value)].slice(0, 8);
        ctx.changePhase(phase, () => ctx.studio.setOverride(field.path, value, { phase }));
        if (phase === 'commit') ctx.refresh();
      },
      onFollow() { ctx.studio.clearOverride(field.path); ctx.refresh(); },
    };
  }

  function picker(ctx, group, field) {
    const meaningful = visibleFields([field], { locale: ctx.locale, tier: 'expert' }).length;
    if (!meaningful || !ui.groups.has(group.id)) return null;
    const args = pickerContext(ctx);
    if (ui.picker && (ui.pickerPath !== field.path || ui.pickerVariant !== ctx.state.variant)) {
      ui.picker.dispose(); ui.picker = null;
    }
    if (!ui.picker) {
      ui.pickerPath = field.path; ui.pickerVariant = ctx.state.variant;
      ui.picker = createColorPicker(args);
    } else ui.picker.update(args);
    return ui.picker.root;
  }

  function fieldRow(ctx, group, field) {
    const { state: s, locale, t } = ctx;
    const value = colorAt(s, field.path);
    const changed = Object.hasOwn(s.project.overrides?.[s.variant] ?? {}, field.path);
    const isOpen = ui.target === field.path;
    const swatch = colorSwatch(value), valueNode = node('span', { class: 'field-value', text: value ?? '—' });
    const mark = node('span', { class: 'field-mark', text: t(changed ? 'changed' : 'automatic') });
    const headingRow = button('', { class: `field-row ${isOpen ? ' is-open' : ''}`, action: 'field', 'data-path': field.path,
      'data-focus': `field:${field.path}`, 'aria-expanded': String(isOpen), 'aria-label': labelFor(field.path, locale) },
      swatch, node('span', { class: 'field-name', text: labelFor(field.path, locale) }), valueNode, mark,
      icon('chevron', 14));
    rows.set(field.path, { swatch, valueNode, mark, headingRow });
    return node('div', { class: 'field-entry' }, headingRow, isOpen && node('div', { class: 'field-expanded', 'data-expanded-field': field.path },
      node('p', { class: 'field-hint u-muted', text: localized(field.hint ?? field.effect?.summary, locale) }), picker(ctx, group, field)));
  }

  function list(ctx) {
    const { state, locale, t } = ctx;
    const override = state.project.overrides?.[state.variant] ?? {};
    const search = ui.query.trim();
    rows.clear();
    const found = visibleFields(catalog.fields, { locale, query: ui.query, tier: ui.tier, only: ui.only, overrides: override, target: ui.target });
    const byGroup = new Map();
    for (const field of found) {
      const collection = byGroup.get(field.group) ?? [];
      collection.push(field);
      byGroup.set(field.group, collection);
    }
    if (searchClear) searchClear.hidden = !ui.query;
    if (searchBody) searchBody.hidden = !search;
    if (searchOptions) searchOptions.hidden = Boolean(search);
    if (!byGroup.size) return node('div', { class: 'empty-state' }, node('p', { text: t('noFields') }),
      button(t('clearFilters'), { action: 'refine-clear', kind: 'u-link', 'data-focus': 'refine-clear' }));
    const openGroups = search || ui.only;
    return node('div', { class: 'field-groups' }, [...groups.values()].filter((group) => byGroup.has(group.id)).map((group) => {
      const visible = byGroup.get(group.id);
      const isOpen = Boolean(openGroups) || ui.groups.has(group.id);
      const changes = Object.keys(override).filter((path) => fields.get(path)?.group === group.id).length;
      return node('section', { class: 'field-group', 'data-field-group': group.id },
        node('div', { class: 'field-group-heading' },
          node('h3', {}, button('', { class: 'group-button', action: 'field-group', 'data-id': group.id,
            'data-focus': `group:${group.id}`, 'aria-expanded': String(isOpen), 'aria-label': localized(group.label, locale),
            disabled: Boolean(openGroups) },
          icon(isOpen ? 'down' : 'chevron', 14), node('span', { text: localized(group.label, locale) }),
          node('span', { class: 'group-count', text: visible.length }))),
          changes > 0 && button(t('clearGroup'), { action: 'clear-group', 'data-id': group.id, glyph: 'reset', iconOnly: true, kind: 'u-mini' })),
        isOpen && node('div', { class: 'field-lines' }, visible.map((field) => fieldRow(ctx, group, field))));
    }));
  }

  function render(ctx) {
    const { t, state } = ctx;
    searchBox = node('input', { type: 'search', value: ui.query, 'aria-label': t('search'), placeholder: t('searchPlaceholder'),
      autocomplete: 'off', 'data-focus': 'search', 'data-input': 'search' });
    searchClear = button(t('clearFilters'), { action: 'refine-clear', glyph: 'x', iconOnly: true, kind: 'u-mini', hidden: !ui.query });
    searchBody = node('span', { class: 'u-muted search-meta', text: t('search'), hidden: !ui.query });
    searchOptions = segment(TIERS.map((value) => ({ value, label: t(value) })), ui.tier, 'tier', t('tiers'));
    const hasChanges = Object.keys(state.project.overrides?.[state.variant] ?? {}).length > 0;
    content = node('div', { class: 'refine-list' }, list(ctx));
    return node('div', { class: 'tab-content refine-page' }, heading(t('refine'), t('refineHint'),
      hasChanges && button(t('clearAll'), { action: 'clear-all', glyph: 'reset', kind: 'u-link', iconOnly: true })),
    node('div', { class: 'refine-tools' },
      node('div', { class: 'u-search' }, icon('search', 16), searchBox, searchClear),
      node('div', { class: 'refine-filters' }, searchOptions, searchBody, toggle(t('onlyChanged'), { checked: ui.only, act: 'only-fields' }))),
    content);
  }

  function lightUpdate(ctx) {
    if (!ui.picker || !ui.target || !ui.picker.root.isConnected) return;
    ui.picker.update(pickerContext(ctx), { lightweight: true });
    const row = rows.get(ui.target);
    if (row) {
      const value = colorAt(ctx.state, ui.target);
      if (row.valueNode.textContent !== value) row.valueNode.textContent = value ?? '—';
      if (isSafeColor(value)) row.swatch.firstElementChild.style.setProperty('--ink', value);
      row.mark.textContent = ctx.t('changed');
    }
  }

  function focusAfter(ctx, path) {
    if (!isVisible(path)) return false;
    ui.target = path; ui.query = ''; ui.only = false;
    const f = fields.get(path);
    ui.groups.add(f.group);
    if (!visibleFields([f], { locale: ctx.locale, tier: ui.tier }).length) ui.tier = f.tier === 'basic' ? 'common' : f.tier ?? (f.group === 'syntax-tokens' ? 'expert' : 'advanced');
    return true;
  }

  const refilter = (ctx, query) => {
    ui.query = query;
    ui.target = '';
    if (ui.picker) ui.picker.dispose();
    ui.picker = null;
    content.replaceChildren(list(ctx));
  };

  return { render, refilter, ui, labelFor, colorAt, focusAfter, lightUpdate, isVisible,
    open(path) { 
      const next = ui.target === path ? '' : path;
      if (ui.picker) ui.picker.dispose();
      ui.picker = null;
      ui.target = next;
      if (next) ui.groups.add(fields.get(next)?.group);
    },
    setTier(value) { ui.tier = value; ui.target = ''; },
    clear() { ui.query = ''; ui.only = false; ui.target = ''; },
    dispose() { ui.picker?.dispose(); },
  };
}
