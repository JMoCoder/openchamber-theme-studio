import assert from 'node:assert/strict';
import { readdirSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveProject } from '../src/core/project.mjs';
import { contrastRatio, parseTheme, themeToCssVariables } from '../shared/theme-core.mjs';
import { openExtension, repo } from './dev-browser.mjs';
import { accent, btn, bytes, closeSettings, css, files, frameNode, json, selectNative,
  settings, sha, until, waitOriginal, writeFixture } from './v-verify-rc2-ui.mjs';

const edition = (v) => v[0].toUpperCase() + v.slice(1);
const other = (v) => v === 'light' ? 'dark' : 'light';
const slug = (v) => v.trim().toLowerCase().replace(/[-\s]+/gu, '-');
const differences = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  .filter((key) => a[key] !== b[key]).map((key) => ({ key, preview: a[key] ?? null, native: b[key] ?? null }));
const reason = (key) => /^--sidebar-overlay-/u.test(key) ? 'ThemeCssGenerator sidebar overlay alpha uses window variant'
  : /^--(?:shadow-|oc-elevation-)/u.test(key) ? 'host light/dark design-system shadow/edge'
  : /^--oc-glass-/u.test(key) ? 'host light/dark design-system glass opacity, blur or saturation'
  : /^--oc-tile-/u.test(key) ? 'host light/dark design-system tile tint strength'
  : /^--oc-scrollbar-/u.test(key) ? 'host light/dark design-system scrollbar'
  : /^--chart-/u.test(key) ? 'host light/dark design-system chart colors (not supplied by theme JSON)'
  : /^--(?:primary|error)-text$/u.test(key) ? 'host readableColors caps the light/dark tint used for text contrast' : null;
const nativeColor = (v) => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/gu, '') : undefined;
const trackedColors = ['--primary-base', '--surface-background', '--surface-foreground', '--primary-hover',
  '--primary-active', '--pr-merged', '--interactive-selection', '--interactive-border', '--syntax-keyword'];
const rawColorMatches = (live, computed) => trackedColors.every((key) =>
  nativeColor(live[key]) === nativeColor(computed[key]));

export async function changeNativeMode(page, v) {
  await settings(page, 'Appearance');
  const choice = page.getByRole('radiogroup', { name: 'Color mode' }).getByRole('radio', { name: new RegExp(`^${edition(v)}\\b`, 'u') });
  await choice.click();
  await until(async () => await choice.getAttribute('aria-checked') === 'true', `native appearance selected ${v}`);
  await closeSettings(page);
  return until(async () => { const r = await css(page); return r.mode === v && r; }, `whole window's actual mode ${v}`);
}

export async function fullRoot(page) {
  const stable = await css(page);
  const extra = await page.evaluate(() => {
    const root = document.documentElement, style = getComputedStyle(root);
    const generated = document.getElementById('opencode-theme-variables')?.textContent ?? '';
    const names = [...new Set([
      ...Array.from(generated.matchAll(/(--[\w-]+)\s*:/gu), (m) => m[1]),
      ...Array.from(style).filter((key) => /^--(?:oc-(?:elevation-|glass-|tile-|scrollbar-)|shadow-|chart-)/u.test(key)),
    ])].sort();
    return {
      rootScheme: style.colorScheme, darkClass: root.classList.contains('dark'),
      generated: Object.fromEntries(names.map((key) => [key, style.getPropertyValue(key).trim()])),
    };
  });
  return { ...stable, ...extra, all: { ...stable.values, ...extra.generated } };
}

export async function compareNative(page, dir, job) {
  const { index, label, v, expected, rendered } = job;
  const id = `l03-reference-${index}-${v}`;
  const definition = { ...expected, metadata: { ...expected.metadata, id, name: `Reference ${index}` } };
  writeFixture(join(dir, `${id}.json`), definition);
  await selectNative(page, v, id);
  const referenceVars = themeToCssVariables(parseTheme(definition));
  const reference = await until(async () => {
    const r = await fullRoot(page);
    return r.mode === v && rawColorMatches(referenceVars, r.all) && r;
  }, `native reference ${id}`);
  const diffs = differences(rendered.all, reference.all).map((change) => ({ ...change, reason: reason(change.key) }));
  const textContrastOnCanvas = diffs.filter(({ key }) => /^--(?:primary|error)-text$/u.test(key)).map(({ key, preview, native }) => ({
    key, preview: contrastRatio(preview, rendered.all['--surface-background']),
    native: contrastRatio(native, reference.all['--surface-background']),
  }));
  return { index, label, native: reference.brief, preview: rendered.brief,
    variables: Object.keys(reference.all).length, generated: Object.keys(reference.generated).length,
    previewScheme: rendered.rootScheme, nativeScheme: reference.rootScheme,
    previewDarkClass: rendered.darkClass, nativeDarkClass: reference.darkClass, diffs, textContrastOnCanvas };
}

export async function crossModeMatrix({ page, frame: initialFrame, state, dir, slot, start, originals, record, capture, report, jobs }) {
  let frame = initialFrame, native = start;
  const cross = other(start);
  const act = (action, id) => frame.locator(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
  const tab = (id) => act('tab', id).click();
  const chooser = (v) => frame.locator(`[data-act=variant][data-value="${v}"]`);
  const help = '#studio-connection-help';
  const menu = async (action) => {
    await frame.locator('summary[aria-label="Theme actions"]').click();
    await act(action).click();
  };
  const toggleLive = async (on) => {
    const live = frame.locator('[data-change=live]');
    if (!await live.isVisible()) await frame.locator('summary[aria-label="Theme actions"]').click();
    if (await live.isChecked() !== on) await live.click();
  };
  const slider = async (key, part, group = '') => {
    const range = frame.locator(`input[type=range][data-knob="${key}"][data-knob-group="${group}"]`);
    await range.scrollIntoViewIfNeeded();
    const { width, height } = await range.boundingBox();
    await range.click({ position: { x: width * part, y: height / 2 } });
  };
  async function pick(label, action, { v = cross, test = () => true, changed = true } = {}) {
    const previous = bytes(slot(native)), inactive = bytes(slot(other(native)));
    await action();
    let paint, expected;
    const rendered = await until(async () => {
      const data = json(slot(native));
      if (data?.metadata?.variant !== native || data.themeStudio?.previewVariant !== v ||
          changed && bytes(slot(native)).sha === previous?.sha || !test(data.themeStudio.project)) return null;
      const source = resolveProject(data.themeStudio.project, v, { compact: false });
      const vars = themeToCssVariables(parseTheme(source));
      const result = await fullRoot(page);
      if (result.mode !== native || !rawColorMatches(vars, result.all)) return null;
      if (await chooser(v).getAttribute('aria-pressed') !== 'true') return null;
      paint = data; expected = source;
      return result;
    }, `${label}: disk revision, iframe tab and generated CSS`);
    assert.deepEqual(bytes(slot(other(native))), inactive, `${label}: must not write the other file`);
    const index = jobs.length + 1;
    const status = await frame.locator('.connection').innerText();
    jobs.push({ index, label, v, rendered, expected });
    record(label, { index, source: v, native, slot: paint.metadata.id, rev: paint.themeStudio.rev, status, sha: rendered.brief.sha });
    return { paint, rendered };
  }

  await pick('matrix: switch to opposite tab with preview active', () => chooser(cross).click());
  const status = frame.locator('.connection');
  await until(async () => (await status.innerText()).includes(`Previewing ${edition(cross)} in a ${edition(start)}-mode window`), 'confirmed cross-mode status');
  await act('show-status-help').click();
  const iframe = frameNode(page);
  const separator = page.locator('[data-context-zone="right"][data-context-panel-open="true"] > [role="separator"]');
  for (let i = 0; i < 4; i++) {
    const w = (await iframe.boundingBox()).width;
    if (Math.abs(w - 320) <= 2) break;
    const grip = await separator.boundingBox();
    const x = grip.x + grip.width / 2, y = grip.y + 32;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + w - 320, y, { steps: 10 }); await page.mouse.up();
    await delay(100);
  }
  const readNarrow = () => frame.locator('.studio').evaluate((root) => {
    const pane = root.getBoundingClientRect();
    return { width: pane.width, scheme: getComputedStyle(root).colorScheme,
      background: getComputedStyle(root).backgroundColor,
      contents: ['.connection', '#studio-connection-help'].map((sel) => {
        const el = root.querySelector(sel), r = el.getBoundingClientRect();
        return { text: el.innerText, fits: r.left >= pane.left - 1 && r.right <= pane.right + 1 && el.scrollWidth <= el.clientWidth + 1 };
      }) };
  });
  const windowHelp = await frame.locator(help).innerText();
  assert.match(windowHelp, /icons, native controls and shadows still follow.*Settings → Appearance/u);
  const narrow = await readNarrow();
  assert.ok(Math.abs(narrow.width - 320) <= 2, `actual panel width: ${narrow.width}`);
  assert.ok(narrow.contents.every((entry) => entry.fits));
  assert.equal(narrow.scheme, cross);
  record('matrix: narrow EN status/hint and color scheme', narrow);
  await capture('320-en');
  await act('show-status-help').click();
  const beforeLocale = files(dir);
  await settings(page, 'Appearance');
  await page.getByRole('combobox', { name: 'Select language' }).click();
  await page.getByRole('option', { name: /Chinese \(Simplified\)|简体中文/u }).click();
  await page.locator('html[lang^="zh"]').waitFor({ state: 'attached' });
  await btn(page, /关闭设置/u).click();
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('.studio[data-locale=zh]').waitFor();
  if (!await frame.locator(help).isVisible()) await act('show-status-help').click();
  await frame.locator(help).waitFor();
  const narrowZh = await readNarrow();
  assert.ok(narrowZh.contents.every((entry) => entry.fits));
  assert.equal(narrowZh.scheme, cross);
  assert.match(narrowZh.contents[0].text, /正在预览[深浅]色版 · 窗口仍为[浅深]色模式/u);
  assert.match(narrowZh.contents[1].text, /原生控件、部分图标和阴影.*设置 → 外观/u);
  record('matrix: narrow ZH status/hint and color scheme', narrowZh);
  await capture('320-zh');
  await btn(page, '设置').click();
  if (!await page.getByRole('heading', { name: '外观', exact: true }).isVisible()) await btn(page, '外观').click();
  await page.getByRole('combobox', { name: '选择语言' }).click();
  await page.getByRole('option', { name: /^(English|英语)$/u }).click();
  await page.locator('html[lang^="en"]').waitFor({ state: 'attached' });
  await closeSettings(page);
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('.studio[data-locale=en]').waitFor();
  if (await frame.locator(help).isVisible()) await act('show-status-help').click();
  await frame.locator(help).waitFor({ state: 'hidden' });
  assert.deepEqual(files(dir), beforeLocale, 'language switches do not paint');

  const current = frame.locator('[data-focus="theme:current"]');
  await current.waitFor();
  assert.equal(await current.getAttribute('data-act'), 'load-current');
  const currentPaint = json(slot(native)), currentFiles = files(dir);
  const currentPair = Object.fromEntries(['light', 'dark'].map((v) =>
    [v, resolveProject(currentPaint.themeStudio.project, v, { compact: false })]));
  assert.notEqual(currentPair[start].colors.surface.background, currentPaint.colors.surface.background);
  await toggleLive(false);
  await act('load-preset', 'blue-etch').click();
  const selection = (id) => frame.locator(`[data-act=load-preset][data-id="${id}"][aria-pressed=true]`);
  await selection('blue-etch').waitFor();
  await toggleLive(true);
  await pick('matrix: Start from current theme (opposite tab)', async () => {
    await current.click();
    await selection('kilnmark').waitFor();
  }, { changed: false });
  const dialog = () => frame.locator('dialog[open]');
  const downloads = join(state.dir, 'home/Downloads');
  mkdirSync(downloads, { mode: 0o700, recursive: true });
  async function exportPair() {
    const before = new Set(readdirSync(downloads));
    await menu('export');
    await dialog().getByRole('combobox').selectOption('both');
    await btn(dialog(), 'Export to Downloads').click();
    await dialog().locator('.report-file').nth(1).waitFor();
    await btn(dialog(), 'Done').click();
    const exported = readdirSync(downloads).filter((name) => name.endsWith('.json') && !before.has(name));
    assert.equal(exported.length, 2);
    return Object.fromEntries(['light', 'dark'].map((v) => [v, join(downloads, exported.find((file) => file.endsWith(`-${v}.json`)))]));
  }
  const pair = await exportPair();
  for (const v of ['light', 'dark']) {
    const recovered = json(pair[v]);
    assert.equal(recovered.metadata.variant, v);
    assert.equal(recovered.themeStudio.previewVariant, undefined);
    assert.deepEqual(recovered.themeStudio.project, currentPaint.themeStudio.project);
    assert.deepEqual(parseTheme(recovered).colors, parseTheme(currentPair[v]).colors);
  }
  assert.deepEqual(files(dir), currentFiles, 'loading the already-painted pair does not alter the native file');
  record('matrix: Start from current theme (opposite tab) recovered both true editions, not the painted native slot', {
    source: cross, native: start, project: currentPaint.themeStudio.project.origin,
    swatches: ['light', 'dark'].map((v) => ({ edition: v, background: currentPair[v].colors.surface.background,
      accent: currentPair[v].colors.primary.base, ...bytes(pair[v]) })),
    nativeSlotActuallyPainted: { background: currentPaint.colors.surface.background, accent: currentPaint.colors.primary.base },
  });

  for (const id of ['afterglow', 'hojicha']) {
    await pick(`matrix: new curated ${id}`, () => act('load-preset', id).click(), {
      test: (project) => project.origin.ref === id,
    });
  }
  await act('toggle-builtins').click();
  const builtin = frame.locator('.builtin-cards [data-act=load-builtin][data-id="aura"]').first();
  await pick('matrix: OpenChamber built-in card', () => builtin.click(), { test: (project) => project.origin.kind === 'builtin' });
  const named = 'L03 real pair';
  const nameSlug = `theme-studio-${slug(named)}`;
  const paths = ['light', 'dark'].map((v) => join(dir, `${nameSlug}-${v}.json`));
  const priorSave = files(dir);
  await act('save').click();
  await dialog().getByRole('textbox').fill(named);
  await dialog().getByRole('combobox').selectOption('both');
  await btn(dialog(), 'Save to file').click();
  await dialog().locator('.report-file').nth(1).waitFor();
  await btn(dialog(), 'Done').click();
  const originalsNamed = paths.map(bytes);
  assert.ok(originalsNamed.every(Boolean));
  assert.deepEqual(bytes(slot(native)), priorSave[basename(slot(native))]);
  for (const [i, v] of ['light', 'dark'].entries()) {
    const saved = json(paths[i]);
    assert.equal(saved.metadata.variant, v);
    assert.equal(saved.themeStudio.previewVariant, undefined);
    assert.deepEqual(parseTheme(saved).colors, parseTheme(resolveProject(saved.themeStudio.project, v)).colors);
  }
  assert.notDeepEqual(json(paths[0]).colors, json(paths[1]).colors);
  record('matrix: Save both variants independently of the overlaid slot', { files: originalsNamed });

  await pick('matrix: Random inspiration', () => act('random').click());
  await pick('matrix: My themes (saves are true variants)', () => act('load-saved', nameSlug).click(), {
    test: (project) => project.origin.kind === 'saved',
  });
  await act('image').click();
  await frame.locator('input#image-file').setInputFiles(join(repo, 'docs/research/evidence/interactions/l03-old-cross.jpg'));
  const image = frame.locator(`[data-act=image-seed][aria-label^="${edition(cross)}:"]`).first();
  await pick('matrix: image palette', () => image.click(), { test: (project) => project.origin.kind === 'image' });

  await pick('matrix: import genuine edition from file', async () => {
    await frame.locator('.theme-sources [data-act=import]').click();
    await dialog().locator('input[type=file]').setInputFiles(paths[cross === 'light' ? 0 : 1]);
    await dialog().getByText('Theme imported', { exact: true }).waitFor();
    await btn(dialog(), 'Done').click();
  });

  await tab('style');
  await pick('matrix: style recipe', () => act('style', 'brutalism').click(), {
    test: (project) => project.style[cross].id === 'brutalism',
  });
  await pick('matrix: style strength', () => slider('strength', .36));
  const option = frame.locator('select[data-change="style-option"]').first();
  const oldOption = await option.inputValue();
  const nextOption = (await option.locator('option').evaluateAll((options) => options.map((o) => o.value))).find((v) => v !== oldOption);
  assert.ok(nextOption);
  await pick('matrix: native style option', () => option.selectOption(nextOption));
  const controls = await frame.locator('.style-settings').evaluate((root) => {
    const scheme = (sel) => {
      const style = getComputedStyle(root.querySelector(sel));
      return { scheme: style.colorScheme, color: style.color, background: style.backgroundColor };
    };
    return { dropdown: scheme('select'), slider: scheme('input[type=range]'),
      scroller: getComputedStyle(root.closest('main')).colorScheme };
  });
  assert.equal(controls.dropdown.scheme, cross);
  assert.equal(controls.slider.scheme, cross);
  assert.equal(controls.scroller, cross);
  record('matrix: native select/range/scrollbar inherit actual panel color scheme', controls);
  await capture('controls');

  await tab('tune');
  await pick('matrix: tune hue', () => slider('hue', .8, 'all'));
  await pick('matrix: generate this edition from the other', () => act('counterpart', cross).click());
  await tab('refine');
  const base = (await css(page)).brief.background.toLowerCase();
  await pick('matrix: refine an accent on the opposite edition', () => accent(frame, base), {
    test: (project) => Object.values(project.overrides[cross]).includes(base),
  });
  await tab('tune');
  await pick('matrix: Fix readability', () => act('repair').click());
  await pick('matrix: undo readability', () => act('undo').click());
  await pick('matrix: redo readability', () => act('redo').click());

  const clipboard = await page.evaluate(() => {
    // Passive observation of clipboard calls from this fixture's sandbox.
    window.__l03Copied = [];
    window.addEventListener('message', (event) => {
      if (event.source === document.querySelector('iframe[title="Theme Studio"]')?.contentWindow &&
          event.data?.type === 'clipboard-write') window.__l03Copied.push(event.data.payload.text);
    });
    return 'fixture SDK observer';
  });
  function validatePortable(doc, v) {
    assert.equal(doc.metadata.variant, v);
    assert.equal(doc.themeStudio.previewVariant, undefined);
    assert.deepEqual(parseTheme(doc).colors, parseTheme(resolveProject(doc.themeStudio.project, v)).colors);
  }
  for (const v of [cross, start]) {
    if (v !== cross) await pick('matrix: tab follows when returning', () => chooser(v).click(), { v });
    await menu('copy-json');
    const copy = await until(async () => {
      const messages = await page.evaluate(() => window.__l03Copied);
      const found = messages.map((text) => JSON.parse(text)).find((item) => item?.metadata.variant === v);
      if (found) return found;
      const manual = frame.locator('dialog[open] textarea');
      return await manual.isVisible() ? JSON.parse(await manual.inputValue()) : null;
    }, `copied JSON for ${v}`, 4500);
    validatePortable(copy, v);
    if (await dialog().isVisible()) await btn(dialog(), 'Close').click();
    record(`matrix: copy genuine ${v} JSON`, { clipboard, sha: sha(JSON.stringify(copy)) });
  }
  const exported = await exportPair();
  for (const v of ['light', 'dark']) validatePortable(json(exported[v]), v);
  record('matrix: export both true editions', { files: Object.values(exported).map((file) => ({ name: basename(file), ...bytes(file) })) });

  // Device/window changes are native user actions. They never replay a draft.
  const beforeSwitch = files(dir);
  const switched = await changeNativeMode(page, cross);
  native = cross;
  assert.deepEqual(switched.values, originals[cross].values);
  await delay(450);
  assert.deepEqual(files(dir), beforeSwitch);
  await tab('theme');
  await pick('matrix: first explicit pick after real mode switch paints the new slot only', () => act('load-preset', 'kilnmark').click(), { v: start });
  await pick('matrix: rapid tabs + last curated pick wins', async () => {
    await chooser(cross).click();
    await chooser(start).click();
    await chooser(cross).click();
    await act('load-preset', 'blue-etch').click();
  }, { v: cross, test: (project) => project.origin.ref === 'blue-etch' });

  const beforePassive = files(dir);
  await frame.locator('summary[aria-label="Theme actions"]').click();
  await frame.locator('[data-change=live]').click();
  await chooser(start).click();
  await chooser(cross).click();
  await act('load-default').click();
  if (!await frame.locator('details.studio-menu').evaluate((el) => el.open)) {
    await frame.locator('summary[aria-label="Theme actions"]').click();
  }
  await frame.locator('[data-change=live]').click();
  await delay(600);
  assert.deepEqual(files(dir), beforePassive);
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await openExtension(page, 'Theme Studio');
  await frame.locator('footer [data-act=save]:enabled').waitFor();
  assert.deepEqual(files(dir), beforePassive);
  await act('restore').click();
  const restore = {};
  const after = await waitOriginal(page, originals[native]);
  restore[native] = after.brief;
  await changeNativeMode(page, start);
  restore[start] = (await waitOriginal(page, originals[start])).brief;
  assert.deepEqual(paths.map(bytes), originalsNamed);
  assert.equal(await chooser(start).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(files(dir)[basename(slot(start))]?.sha === beforePassive[basename(slot(start))]?.sha, false);
  assert.deepEqual(files(dir)[basename(slot(cross))]?.sha === beforePassive[basename(slot(cross))]?.sha, false);
  record('matrix: passive actions did not write; one restore after remount and mode switch restores both palettes and editor', {
    restore, named: paths.map(bytes), slots: [bytes(slot('light')), bytes(slot('dark'))],
  });

  // Native settings select the same source project anew. This compares actual host
  // rendering to actual host rendering, not the iframe to its own CSS.
  report.nativeComparisons = [];
  for (const v of ['light', 'dark']) {
    await changeNativeMode(page, v);
    for (const job of jobs.filter((entry) => entry.v === v)) {
      const info = await compareNative(page, dir, job);
      report.nativeComparisons.push(info);
      if (job.label === 'opposite tab → curated Kilnmark') await capture('same-palette-native');
      assert.ok(info.diffs.every((item) => item.reason), `${job.label}: unexplained ${JSON.stringify(info.diffs)}`);
    }
  }
  record('matrix: true native reference comparisons complete', { comparisons: report.nativeComparisons.length });
}
