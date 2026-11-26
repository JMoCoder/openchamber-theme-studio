const paths = {
  palette: '<path d="M12 20a8 8 0 1 1 8-8c0 1.4-1 2-2 2h-2a1.5 1.5 0 0 0-1.2 2.4c1.1 1.4-.3 3.6-2.8 3.6Z"/><path d="M7.5 12h.01m2-3.4h.01m4-1h.01m3 2.8h.01" stroke-width="2.6"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.7v2m0 14.6v2M2.7 12h2m14.6 0h2M5.4 5.4l1.4 1.4m10.4 10.4 1.4 1.4m0-13.2-1.4 1.4M6.8 17.2l-1.4 1.4"/>',
  moon: '<path d="M20.3 15.4A9 9 0 0 1 8.6 3.7 8.6 8.6 0 1 0 20.3 15.4Z"/>',
  more: '<path d="M5 12h.01m7 0h.01m7 0h.01" stroke-width="3"/>',
  eye: '<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5m-5 5 5-5 5 5"/>', arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  corner: '<path d="M8 6h10v10M18 6 6 18"/>',
  layers: '<path d="m12 4 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
  sparkle: '<path d="M12 2.5c.9 5 3 7.1 8.5 8.5-5.5 1.4-7.6 3.5-8.5 8.5-.9-5-3-7.1-8.5-8.5C9 9.6 11.1 7.5 12 2.5Zm7 14v5m-2.5-2.5h5"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M9 4v4m6 2v4m-5 2v4" stroke-width="2.6"/>',
  droplet: '<path d="M12 3s6.5 6.8 6.5 11a6.5 6.5 0 0 1-13 0c0-4.2 6.5-11 6.5-11Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  type: '<path d="M4 18 9.6 5 15 18M6 14h7m1.5 4 3.5-8 3.5 8m-5.8-2h4.5"/>',
  undo: '<path d="M9 7 4 12l5 5m-5-5h11a4.5 4.5 0 0 1 4.5 4.5"/>',
  redo: '<path d="m15 7 5 5-5 5m5-5H9a4.5 4.5 0 0 0-4.5 4.5"/>',
  reset: '<path d="M4.4 9a8 8 0 1 1 .8 7.2M4 4.5v5h5"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  pencil: '<path d="m14 5 5 5M4 20l4-.9L20 7l-4-4L4 15l-.9 4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>', x: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-8h.01"/>',
  warning: '<path d="m10.7 4.5-8 14a1.4 1.4 0 0 0 1.2 2h16.2a1.4 1.4 0 0 0 1.2-2l-8-14a1.5 1.5 0 0 0-2.6 0Z"/><path d="M12 10v4m0 3h.01"/>',
  link: '<path d="m10 14 4-4m-7 6-1 1a3.2 3.2 0 0 0 4.5 4.5l4.2-4.2a3.2 3.2 0 0 0 0-4.5m-5.4-1.6a3.2 3.2 0 0 1 0-4.5l4.2-4.2a3.2 3.2 0 0 1 4.5 4.5l-1 1" transform="translate(.6 .6) scale(.95)"/>',
  upload: '<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4.5 14v5h15v-5"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M4.5 15v5h15v-5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-4 3 2.5 3.5-5 5 5"/>',
  shuffle: '<path d="M4 7h3c4 0 6 10 10 10h3m-4-4 4 4-4 4M4 17h3c1 0 2-1 3-2.5m4-5C15 8 16 7 17 7h3m-4-4 4 4-4 4"/>',
  search: '<circle cx="10" cy="10" r="5.5"/><path d="m14 14 5 5"/>',
  eyedrop: '<path d="m13 6 5 5m-.3-7.7a2.2 2.2 0 0 1 3.1 3.1L10 17.3 4 20l2.8-6 10.9-10.7Z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-12-4 14"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-9c0 5-7 3-12 7"/>',
  file: '<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8m-8 4h6"/>',
  shield: '<path d="m12 3 8 3v5c0 4.4-3 7.5-8 10-5-2.5-8-5.6-8-10V6l8-3Z"/><path d="m8 12 2.5 2.5L16 9"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  trash: '<path d="M4 6h16M9 6V4h6v2m3 0-1 14H7L6 6m4 4v6m4-6v6"/>',
};

export function node(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') for (const [name, val] of Object.entries(value)) el.style.setProperty(name, val);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (['value', 'checked', 'disabled', 'selected', 'open'].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
  return el;
}

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  // This markup is selected solely from the constant icon table, never from project data.
  svg.innerHTML = paths[name] ?? paths.info;
  return svg;
}

export function button(label, { action, kind = '', glyph, iconOnly = false, ...props } = {}, ...extra) {
  return node('button', { type: 'button', class: `u-button ${kind}${iconOnly ? ' is-icon' : ''}`,
    ...(action ? { 'data-act': action } : {}), ...(iconOnly ? { 'aria-label': label, title: label } : {}), ...props },
  glyph && icon(glyph), !iconOnly && label && node('span', { class: 'u-button-label', text: label }), extra);
}

export const heading = (title, sub, action) => node('div', { class: 'section-heading' },
  node('div', {}, node('h2', { text: title }), sub && node('p', { class: 'u-muted', text: sub })), action);

export function toggle(label, { act, checked = false, disabled = false, title } = {}) {
  return node('label', { class: 'u-toggle', title },
    node('input', { type: 'checkbox', role: 'switch', 'data-change': act, 'data-focus': `switch:${act}`, checked, disabled, 'aria-label': title ?? label }),
    node('span', { class: 'switch-art', 'aria-hidden': 'true' }),
    node('span', { text: label }));
}

export const segment = (items, value, group, label, attr = 'data-value') =>
  node('div', { class: 'u-segment', role: 'group', 'aria-label': label },
    items.map((item) => button(item.label, { glyph: item.icon, kind: 'u-segment-button', action: group, [attr]: item.value,
      'data-focus': `${group}:${item.value}`, 'aria-pressed': String(item.value === value) })));

export function optionList(choices, value) {
  return choices.map(([key, label]) => node('option', { value: key, selected: key === value, text: label }));
}
