import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { openExtension } from './dev-browser.mjs';

export const title = 'Theme Studio';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const raw = path => existsSync(path) ? readFileSync(path) : null;
export const json = path => { const bytes = raw(path); return bytes && JSON.parse(bytes); };
export const btn = (root, name) => root.getByRole('button', { name, exact: true });
export const tab = (frame, name) => frame.getByRole('tab', { name, exact: true });
export const footer = (frame, label) => btn(frame.locator('footer'), label);
export const frameNode = page => page.locator(`iframe[title="${title}"]`);
export const sidebarNode = page => page.locator('[data-context-surface="plugin:theme-studio"]').and(btn(page, title));

export async function until(check, label, ms = 30_000) {
  const end = performance.now() + ms;
  do {
    const found = await check();
    if (found) return found;
    await wait(75);
  } while (performance.now() < end);
  throw new Error(`Not observed: ${label} (${ms} ms)`);
}

export function bytes(path) {
  const buf = raw(path);
  return buf === null ? null : { sha: sha(buf), bytes: buf.length, mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString() };
}
export function files(dir) {
  return Object.fromEntries(readdirSync(dir).sort().map(name => [name, bytes(join(dir, name))]));
}
export function theme(path) {
  const doc = json(path);
  return doc && { ...bytes(path), id: doc.metadata.id, name: doc.metadata.name, variant: doc.metadata.variant,
    primary: doc.colors.primary.base, background: doc.colors.surface?.background, rev: doc.themeStudio?.rev,
    marked: Boolean(doc.themeStudio), borrowedApplied: doc.themeStudio?.borrowedApplied ?? false };
}
export const writeFixture = (path, doc) => writeFileSync(path, typeof doc === 'string' ? doc : `${JSON.stringify(doc, null, 2)}\n`,
  { flag: 'wx', mode: 0o600 });

export async function css(page) {
  const result = await page.evaluate(() => {
    const el = document.documentElement;
    const style = getComputedStyle(el);
    const variables = [...new Set([...el.style, ...Array.from(style)
      .filter(key => /^--(?:primary-|surface-|syntax-|chat-|status-|tools-|sidebar-|markdown-|interactive-|pr-)/u.test(key)),
      '--primary-base', '--background', '--foreground', '--radius', '--font-sans', '--font-mono'])].sort();
    // Layout variables and desktop startup-page cache are host plumbing, not
    // active theme paint. Record the desktop splash separately from disk.
    const colors = variables.filter(key => key.startsWith('--') && !/^--(?:oc-|splash-)/u.test(key));
    return { mode: el.getAttribute('data-theme'), media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      values: Object.fromEntries(colors.map(key => [key, style.getPropertyValue(key).trim()])) };
  });
  const { values: v, mode, media } = result;
  return { ...result, brief: { mode, media, variables: Object.keys(v).length, sha: sha(JSON.stringify(v)),
    primary: v['--primary-base'], background: v['--background'], radius: v['--radius'],
    font: v['--font-sans'], mono: v['--font-mono'] } };
}
export const waitColor = (page, color, mode) => until(async () => {
  const current = await css(page);
  return current.brief.primary === color && (!mode || current.mode === mode) && current;
}, `whole-window primary=${color}, mode=${mode ?? 'any'}`);
export const waitOriginal = (page, base) => until(async () => {
  const current = await css(page);
  return current.brief.sha === base.brief.sha && current.mode === base.mode && current;
}, `original whole-window CSS (${base.mode} ${base.brief.primary})`);
export const diffCss = (before, after) => [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])]
  .filter(key => before.values[key] !== after.values[key]);

export const config = dir => Object.fromEntries(['settings.json', 'preferences.json'].map(name => [name, raw(join(dir, name))]));
export function configDiff(before, after) {
  const parse = buf => buf === null ? {} : JSON.parse(buf);
  const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  const themeFields = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => /^(theme\w*|(light|dark)ThemeId|useSystemTheme)$/u.test(k))
    .map(([k, field]) => [k, field && typeof field === 'object' && 'value' in field ? field.value : field]));
  return Object.fromEntries(Object.keys(before).map(name => {
    const a = parse(before[name]), b = parse(after[name]);
    return [name, { keys: changed(a, b), fieldsChanged: changed(a.fields ?? {}, b.fields ?? {}),
      before: before[name] && sha(before[name]), after: after[name] && sha(after[name]),
      themeBefore: themeFields(a.fields ?? a), themeAfter: themeFields(b.fields ?? b),
      splashBefore: a.desktopSplashColors ?? null, splashAfter: b.desktopSplashColors ?? null }];
  }));
}

export async function settings(page, name) {
  if (!await btn(page, 'Close settings').isVisible()) await btn(page, 'Settings').click();
  const heading = page.getByRole('heading', { name, exact: true });
  if (!await heading.isVisible()) await btn(page, name).click();
  await heading.waitFor();
}
export async function closeSettings(page) {
  await btn(page, 'Close settings').click();
  await btn(page, 'Close settings').waitFor({ state: 'hidden' });
}
export async function add(ctx) {
  const { page, record } = ctx;
  await settings(page, 'Extensions');
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  assert.equal(await frameNode(page).count(), 0);
  await btn(page, /^Add extension Folder/u).click();
  await page.getByRole('textbox', { name: 'Folder, ZIP, or URL' }).fill('/lab/extension');
  await btn(page, 'Add extension from a folder, ZIP, or URL').click();
  const prompt = page.getByRole('dialog', { name: 'Allow Theme Studio?' });
  await prompt.waitFor();
  const promptText = await prompt.ariaSnapshot();
  assert.match(promptText, /Theme Studio v0\.1\.0 wants to/u);
  assert.match(promptText, /~\/\.config\/openchamber\/themes\/theme-studio-\*\.json/u);
  record('native-add-permission-prompt', { path: '/lab/extension', prompt: promptText.split('\n') });
  return prompt;
}
export async function openRight(ctx, page = ctx.page) {
  const frame = await openExtension(page, title);
  if (page === ctx.page) ctx.frame = frame;
  await tab(frame, 'Theme').waitFor();
  const box = await frameNode(page).boundingBox();
  const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.equal(await sidebarNode(page).count(), 1);
  assert.ok(box && box.x > view.width * 0.44 && box.x + box.width >= view.width * 0.90);
  ctx.record('opened-native-right-sidebar', { peer: page !== ctx.page, surface: 'plugin:theme-studio', box, view,
    workStatusPressed: await btn(page, 'Toggle work-status panel').getAttribute('aria-pressed') });
  return frame;
}
export async function approve(ctx, prompt) {
  await btn(prompt ?? await add(ctx), 'Allow and enable').click();
  ctx.record('clicked-native-allow-and-enable');
  await closeSettings(ctx.page);
  const frame = await openRight(ctx);
  const registry = await until(() => {
    const r = json(join(ctx.state.openchamberData, 'extensions.json'));
    return r?.paths?.includes('/lab/extension') && r.capabilityGrants?.['theme-studio'] && r;
  }, 'native settings registered the approved local folder', 15_000);
  ctx.record('confirmed-native-registration-after-sidebar-open', { registeredPaths: registry.paths,
    registeredGrantIds: Object.keys(registry.capabilityGrants) });
  return frame;
}
export async function remove(ctx) {
  const { page, record } = ctx;
  if (ctx.sdk) await ctx.sdk();
  await settings(page, 'Extensions');
  await btn(page, /Theme Studio Folder · v0\.1\.0/u).click();
  await btn(page, 'Remove Theme Studio').click();
  const confirm = btn(page, 'Remove');
  if (await confirm.waitFor({ timeout: 1000 }).then(() => true, () => false)) await confirm.click();
  await page.getByText('No extensions loaded.', { exact: true }).waitFor();
  await closeSettings(page);
  assert.equal(await frameNode(page).count(), 0);
  assert.equal(await sidebarNode(page).count(), 0);
  const registry = await until(() => {
    const r = json(join(ctx.state.openchamberData, 'extensions.json')) ?? {};
    return !r.paths?.includes('/lab/extension') && !r.capabilityGrants?.['theme-studio'] && r;
  }, 'native removal cleared the folder and grant', 15_000);
  record('native-extension-removed', { extensions: 'No extensions loaded.', sidebar: 'absent', iframe: 'absent',
    registeredPaths: registry.paths ?? [], registeredGrantIds: Object.keys(registry.capabilityGrants ?? {}) });
}
async function appearance(page, mode) {
  await settings(page, 'Appearance');
  await btn(page.getByRole('group', { name: 'Themes', exact: true }), mode === 'light' ? 'Light' : 'Dark').click();
  return page.getByRole('listbox', { name: `${mode === 'light' ? 'Light' : 'Dark'} theme`, exact: true });
}
export async function selectNative(page, mode, id) {
  const option = (await appearance(page, mode)).locator(`[data-theme-id="${id}"][role=option]`);
  await option.click();
  await until(async () => await option.getAttribute('aria-selected') === 'true', `native selected ${id}`, 4500);
  await closeSettings(page);
}
export async function deleteNative(ctx, items) {
  for (const item of items) {
    const row = (await appearance(ctx.page, item.variant)).locator(`[data-theme-id="${item.id}"]`);
    await btn(row, /delete|remove/iu).click();
    const confirm = btn(ctx.page, /^(Delete|Remove)$/u).filter({ visible: true });
    if (await confirm.waitFor({ timeout: 1000 }).then(() => true, () => false)) await confirm.click();
    await until(() => !existsSync(join(ctx.dir, `${item.id}.json`)), `native deleted ${item.id}`);
  }
  await closeSettings(ctx.page);
  ctx.record('native-appearance-deleted-separately-from-restore', { ids: items.map(item => item.id), files: files(ctx.dir) });
}
export async function switchMode(page, mode) {
  await page.emulateMedia({ colorScheme: mode });
  return until(async () => {
    const actual = await css(page);
    return actual.mode === mode && actual.media === mode && actual;
  }, `host follows simulated system ${mode}`);
}
export async function editorMode(frame, mode) {
  const option = btn(frame.getByRole('group', { name: 'Edit theme variant' }), mode === 'light' ? 'Light' : 'Dark');
  if (await option.getAttribute('aria-pressed') !== 'true') {
    await option.click();
    await until(async () => await option.getAttribute('aria-pressed') === 'true', `editor variant ${mode}`, 5500);
  }
}

export const preview = frame => frame.getByRole('group', { name: 'Preview samples' }).evaluate(el => {
  const style = getComputedStyle(el);
  return Object.fromEntries(['primary', 'background', 'border', 'syntax-keyword'].map(key => [key, style.getPropertyValue(`--v-${key}`).trim()]));
});
export const panelState = frame => frame.locator('body').evaluate(el => {
  const connection = el.querySelector('.connection');
  const apply = el.querySelector('footer .footer-apply');
  return { connection: connection?.querySelector('[role=status]')?.innerText ?? connection?.innerText,
    actions: [...el.querySelectorAll('.status-actions button')].map(e => ({ name: e.innerText, disabled: e.disabled })),
    footer: apply?.innerText, footerDisabled: apply?.disabled };
});
export async function draft(frame, preset, recipe, font = false) {
  const guide = btn(frame, 'Dismiss getting started');
  if (await guide.isVisible()) await guide.click();
  const button = btn(frame, `Use ${preset}`);
  await button.waitFor({ timeout: 24_000 });
  const initial = await preview(frame);
  await button.click();
  await tab(frame, 'Style').click();
  const beforeRecipe = await preview(frame);
  await btn(frame, `Use ${recipe}`).click();
  const afterRecipe = await preview(frame);
  assert.notDeepEqual(beforeRecipe, afterRecipe);
  const report = { preset, recipe, initial, beforeRecipe, afterRecipe };
  if (font) {
    await tab(frame, 'Pairings').click();
    const familyField = frame.getByRole('combobox', { name: /Try a family installed on this device/u }).first();
    const computed = () => frame.locator('.font-sample').first().evaluate(el => getComputedStyle(el).fontFamily);
    const from = await computed();
    await familyField.fill('serif');
    const to = await computed();
    assert.notEqual(to, from);
    assert.match(to, /\bserif\b/u);
    report.sampleFont = { from, to };
  }
  return report;
}
export async function accent(frame, hex) {
  const field = frame.getByRole('textbox', { name: 'HEX', exact: true });
  if (!await field.isVisible()) await btn(frame, 'Auto accept: Accent').click();
  await field.fill(hex);
  await field.press('Enter');
  await until(async () => (await preview(frame)).primary.toLowerCase() === hex, `draft preview ${hex}`, 3000);
}

export async function apply(ctx, base, { mode = base.mode, button, beforeClick } = {}) {
  const { page, frame, record } = ctx;
  const actualButton = button ? btn(frame, button) : footer(frame, 'Apply');
  const slot = ctx.slot(mode);
  // Select the real primary Apply, never wait on the optional “Try in the app” shortcut.
  record('early-state-for-apply', { mode, ui: await panelState(frame), sample: await preview(frame), file: theme(slot) });
  await until(async () => await actualButton.isVisible() && await actualButton.isEnabled(), `enabled ${button ?? 'footer Apply'}`, 18_000);
  const before = await panelState(frame);
  const sample = await preview(frame);
  const previous = theme(slot);
  const click = performance.now();
  record('clicked-visible-apply-once', { mode, control: button ?? 'footer Apply', ui: before, sample, previous });
  if (beforeClick) beforeClick();
  await actualButton.click();
  const written = await until(() => { const current = theme(slot); return current && current.sha !== previous?.sha && current; },
    `new on-disk file for ${mode}`, 18_000);
  record('first-written-actual-file', { mode, written, ui: await panelState(frame), host: (await css(page)).brief });
  assert.equal(written.id, `openchamber-${mode}`, 'Apply was on a known built-in; writing a personal slot is not whole-window application');
  assert.equal(written.primary, sample.primary);
  const applied = await waitColor(page, sample.primary, mode);
  const file = await until(() => { const current = theme(slot); return current?.borrowedApplied && current; }, 'confirmed borrowed file');
  const changed = diffCss(base, applied);
  assert.ok(changed.length > 1, 'should change theme variables outside the iframe');
  assert.deepEqual([applied.brief.radius, applied.brief.font, applied.brief.mono],
    [base.brief.radius, base.brief.font, base.brief.mono]);
  record('actual-borrow-whole-window', { elapsedMs: Math.round(performance.now() - click), changed: changed.length,
    host: applied.brief, sample, file, ui: await panelState(frame) });
  return { file, applied };
}
export async function restore(ctx, original) {
  const { frame, page, record } = ctx;
  const path = ctx.slot(original.mode);
  const old = theme(path);
  await btn(frame, 'Restore original theme').click();
  const file = await until(() => {
    const item = theme(path);
    return item?.id === `theme-studio-live-${original.mode}` && item;
  }, 'restore retired the borrowed ID');
  const rendered = await waitOriginal(page, original);
  assert.notEqual(file.sha, old?.sha);
  assert.deepEqual(rendered.values, original.values);
  record('plugin-restore-without-native-settings-action', { mode: original.mode, before: old, file, host: rendered.brief,
    ui: await panelState(frame) });
  return file;
}

export async function save(frame, name, variants) {
  await footer(frame, 'Save as').click();
  const dialog = frame.getByRole('dialog', { name: 'Save as', exact: true });
  await dialog.getByRole('textbox', { name: 'Theme name' }).fill(name);
  await dialog.getByRole('combobox', { name: 'Choose which variants to save' }).selectOption({ label: variants });
  await btn(dialog, 'Save as').click();
  await dialog.getByText('Saved', { exact: true }).waitFor();
  const details = await dialog.ariaSnapshot();
  await btn(dialog, 'Done').click();
  return details.split('\n').filter(line => line.includes('~/.config/openchamber/themes/'));
}
async function menu(frame, name) {
  await frame.locator('summary[aria-label="Theme actions"]').click();
  await btn(frame, name).click();
}
export async function exportLight(frame) {
  await menu(frame, 'Export files');
  const dialog = frame.getByRole('dialog', { name: 'Export files', exact: true });
  await dialog.getByRole('combobox', { name: 'Choose which variants to save' }).selectOption({ label: 'Light' });
  await btn(dialog, 'Export files').click();
  await dialog.getByText('Exported', { exact: true }).waitFor();
  const details = await dialog.ariaSnapshot();
  await btn(dialog, 'Done').click();
  return details.split('\n').filter(line => line.includes('~/Downloads/'));
}
export async function importFile(frame, path, outcome = 'Theme imported') {
  await menu(frame, 'Import a theme');
  const dialog = frame.getByRole('dialog', { name: 'Import OpenChamber theme', exact: true });
  await dialog.locator('input[type=file]').setInputFiles(path);
  await dialog.getByText(outcome, { exact: true }).waitFor();
  const details = await dialog.ariaSnapshot();
  const done = btn(dialog, 'Done');
  await (await done.isVisible() ? done : btn(dialog, 'Close')).click();
  return details;
}
