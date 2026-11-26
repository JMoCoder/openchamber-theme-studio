import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../data/fields.json' with { type: 'json' };
import index from '../../presets/index.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { contrastRatio, parseTheme, themeToCssVariables } from '../../shared/theme-core.mjs';
import zh from '../i18n/ui.zh.mjs';
import en from '../i18n/ui.en.mjs';
import { chromePalette, colorToHex, contrastForField, filesUnchecked, fromHsv, isHex, isSafeColor, language, schemeForBackground, statusOf, toHsv, visibleFields, words, writeNeedsRetry } from './model.mjs';
import { currentEntry } from './pages.mjs';
import { cardSwatches } from './preview.mjs';

test('all UI strings are bilingual; language handles host zh variants', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  assert.equal(language('zh-Hant-TW'), 'zh');
  assert.equal(language('es-ES'), 'en');
  assert.equal(words('zh')('copyVariantPath', { variant: '浅色' }), '复制浅色文件路径');
  assert.equal(words('en')('manageSaved', { name: '我的 Work' }), 'Delete or remove 我的 Work');
});

test('HSV and 8-digit HEX retain alpha and grayscale hue', () => {
  const input = { r: 219, g: 30, b: 98, a: .42 };
  const check = toHsv(input);
  assert.equal(colorToHex(fromHsv(check)), '#db1e626b');
  assert.equal(toHsv({ r: 16, g: 16, b: 16, a: 1 }, 160).h, 160);
  assert.ok(isHex('#fe0c'));
  assert.ok(!isHex('#12'));
  for (const bad of ['url(https://example.invalid)', 'linear-gradient(red,blue)', 'var(--a)', '#fff; color:red', 'currentColor']) assert.equal(isSafeColor(bad), false);
});

test('chrome is readable across its surfaces, focus and hover even for hostile color choices', () => {
  let seed = 329;
  const hex = () => '#' + ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8).toString(16).padStart(6, '0');
  for (let i = 0; i < 260; i++) {
    const background = i < 4 ? ['#777777', '#767676', '#ff09fa', '#0ff'][i] : hex();
    const palette = chromePalette({
      background, foreground: i < 4 ? background : hex(), muted: hex(), primary: hex(), primaryForeground: hex(),
      border: hex(), elevated: hex(), focus: background, warning: hex(), error: hex(),
    }, i % 2 ? 'dark' : 'light');
    for (const front of ['fg', 'muted', 'raised', 'raised-muted', 'accent', 'warning', 'error', 'info', 'success']) {
      for (const back of ['bg', 'surface', 'hover', 'selection']) {
        assert.ok(contrastRatio(palette[front], palette[back]) >= 4.5, `${background} ${front}/${back}`);
      }
    }
    assert.ok(contrastRatio(palette.action, palette.primary) >= 4.5);
    assert.ok(contrastRatio(palette.action, palette['primary-hover']) >= 4.5);
    for (const back of ['bg', 'surface', 'hover', 'selection']) {
      assert.ok(contrastRatio(palette.focus, palette[back]) >= 3);
      assert.ok(contrastRatio(palette.control, palette[back]) >= 3);
    }
  }
});

test('only renderer-backed fields are searchable and levels expand cumulatively', () => {
  const options = { locale: 'zh' };
  const common = visibleFields(catalog.fields, options);
  const advanced = visibleFields(catalog.fields, { ...options, tier: 'advanced' });
  const expert = visibleFields(catalog.fields, { ...options, tier: 'expert' });
  assert.ok(common.length >= 22 && advanced.length > common.length && expert.length > advanced.length);
  assert.ok(!expert.some((field) => field.tier === 'hidden' || field.effect.kind === 'dead'));
  const path = 'colors.chat.userMessageBackground';
  assert.ok(visibleFields(catalog.fields, { ...options, query: 'userMessageBackground' }).some((field) => field.path === path));
  assert.ok(visibleFields(catalog.fields, { ...options, only: true, overrides: { [path]: '#fff' }, tier: 'expert' }).every((field) => field.path === path));
});

test('transparent background ratios use the composed canvas and correct foreground direction', () => {
  const field = catalog.fields.find((f) => f.path === 'colors.chat.userMessageBackground');
  const outcomes = contrastForField(field, '#ffffff00', (path) => path.endsWith('mutedForeground') ? '#555' : '#111', '#00000080', 'light');
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes[0].ratio < 5 && outcomes[0].ratio > 4);
  assert.ok(outcomes[1].ratio < outcomes[0].ratio);
});

test('a conflict takes precedence over a waiting write; inactive mode is not a timeout', () => {
  const t = words('en');
  const state = { phase: 'ready', variant: 'dark', host: { mode: 'light' },
    live: { light: { connection: 'conflict', sync: 'waiting' }, dark: { connection: 'hidden', sync: 'timeout' } } };
  assert.equal(statusOf(state, t).text, t('stateConflict'));
  state.live.light.connection = 'off'; state.live.light.sync = 'idle';
  assert.equal(statusOf(state, t).text, 'Panel preview only');
});

test('legacy preview copy distinguishes a recoverable built-in from a preview that must be kept in Chinese and English', () => {
  const lane = { connection: 'prepare-error', sync: 'idle', recovery: 'builtin', error: { code: 'PREVIEW_BACKUP_MISSING' } };
  const state = { phase: 'ready', variant: 'light', host: { mode: 'light' }, live: { light: lane } };
  for (const [locale, pending, action, unavailable, keep] of [
    ['zh', '旧预览待恢复', '恢复内置配色', '无法找回原配色', /不必删除/u],
    ['en', 'Old preview to clear', 'Restore built-in colors', 'Original colors unavailable', /without deleting/u],
  ]) {
    const t = words(locale);
    lane.recovery = 'builtin';
    assert.equal(statusOf(state, t).text, pending);
    assert.equal(statusOf(state, t).recovery, 'builtin');
    assert.equal(t('recoverBuiltinAction'), action);
    assert.match(t('legacyBuiltinNote', { name: 'Flexoki' }), /Flexoki/u);
    lane.recovery = 'preserve';
    assert.equal(statusOf(state, t).text, unavailable);
    assert.equal(statusOf(state, t).recovery, 'preserve');
    assert.match(t('previewBackupMissing'), keep);
  }
});

test('status labels the colors observed outside the panel, including while another edition waits', () => {
  const lane = { connection: 'tryon', sync: 'applied', previewVariant: 'dark', borrowed: { inUse: true } };
  const state = { phase: 'ready', variant: 'light', host: { mode: 'light' }, live: { light: lane } };
  assert.equal(statusOf(state, words('en')).text, 'Previewing Dark in a Light-mode window');
  assert.equal(statusOf(state, words('zh')).text, '正在预览深色版 · 窗口仍为浅色模式');
  lane.sync = 'waiting';
  assert.match(statusOf(state, words('en')).text, /waiting.*Showing Dark colors/iu);
  state.live.enabled = false;
  assert.match(statusOf(state, words('zh')).text, /整窗预览已关.*当前显示深色配色/u);
});

test('iframe native color scheme follows the established panel background in both directions', () => {
  assert.equal(schemeForBackground(chromePalette({ background: '#13171b' }, 'light').bg), 'dark');
  assert.equal(schemeForBackground(chromePalette({ background: '#f8f1ea' }, 'dark').bg), 'light');
  assert.equal(schemeForBackground(chromePalette({}, 'dark').bg), 'dark');
});

test('a try-on opens the working project, not the built-in with the same id', () => {
  const current = { kind: 'tryon', id: 'flexoki-light', name: 'Draft' };
  const state = { host: { active: { light: current } }, variant: 'light', library: { builtins: [{ id: 'flexoki', ids: ['flexoki-light'] }] } };
  assert.equal(currentEntry(state, { loadCurrent() {} }).action, 'load-current');
  assert.equal(currentEntry(state, {}), null);
  current.kind = 'builtin';
  assert.deepEqual(currentEntry(state, {}), { kind: 'builtin', id: 'flexoki', name: 'Draft', action: 'load-builtin' });
});

test('Start from current theme uses the window’s Light selection even in the Dark tab', () => {
  const current = { kind: 'tryon', id: 'flexoki-light', name: 'Window draft' };
  const state = { variant: 'dark', host: { mode: 'light', active: { light: current, dark: {
    kind: 'slot', id: 'theme-studio-live-dark', name: 'Not the selected window theme',
  } } } };
  assert.deepEqual(currentEntry(state, { loadCurrent() {} }), { ...current, action: 'load-current' });
});

test('window preview status distinguishes eligible, disabled, confirmed, unknown, dormant and late update', () => {
  const t = words('zh'), en = words('en');
  const active = { kind: 'builtin', name: 'OpenChamber', id: 'openchamber-light' };
  const lane = { canTryOn: true, connection: 'off', sync: 'idle', borrowed: null };
  const state = { phase: 'ready', variant: 'light', host: { mode: 'light', active: { light: active } }, live: { light: lane, enabled: true } };
  const status = () => statusOf(state, t);
  assert.equal(status().text, '编辑时可整窗预览');
  state.live.enabled = false;
  assert.equal(status().text, '仅面板预览 · 整窗预览已关');
  state.live.enabled = true;
  lane.canTryOn = false;
  assert.equal(status().text, '仅面板预览');
  lane.connection = 'tryon';
  lane.borrowed = { ...active, inUse: true, applied: false };
  assert.equal(status().text, '整窗预览 · OpenChamber');
  lane.borrowed.applied = true;
  assert.equal(statusOf(state, en).text, 'Window preview · OpenChamber');
  lane.borrowed.inUse = null;
  assert.match(status().text, /尚未确认/);
  lane.sync = 'timeout';
  assert.equal(status().text, t('syncTimeout'));
  lane.sync = 'applied'; lane.borrowed.inUse = true;
  assert.equal(status().text, '整窗预览 · OpenChamber');
  lane.borrowed.inUse = false;
  assert.match(status().text, /仅面板预览 · 未选用/);
  lane.sync = 'timeout';
  assert.match(status().text, /未选用/, 'a known theme switch is more informative than the sync deadline');
  lane.connection = 'unavailable';
  assert.equal(status().text, t('stateUnavailable'));
});

test('unverified files and write errors stay actionable without suggesting an Apply workflow', () => {
  const t = words('en');
  const active = { kind: 'builtin', name: 'OpenChamber', id: 'openchamber-light' };
  const lane = { connection: 'checking', sync: 'idle', canTryOn: false };
  const state = { phase: 'booting', variant: 'light', host: { mode: 'light', active: { light: active } }, live: { light: lane } };
  const status = () => statusOf(state, t);
  assert.equal(status().text, t('stateCheckingFiles'));
  assert.equal(filesUnchecked(status()), true);
  state.phase = 'ready';
  lane.connection = 'read-error';
  lane.readError = { code: 'HOST_TIMEOUT' };
  assert.match(status().text, /read/i);
  assert.notEqual(status().text, t('stateError'));
  assert.equal(status().active.id, 'openchamber-light');
  assert.equal(filesUnchecked(status()), true);
  lane.connection = 'unavailable';
  lane.readError.code = 'NOT_GRANTED';
  assert.equal(status().text, t('stateUnavailable'));
  lane.readError.code = 'NO_THEME_DIRECTORY';
  assert.equal(status().text, t('stateMissingDirectory'));
  lane.connection = 'off';
  lane.canTryOn = true;
  lane.sync = 'preflight';
  assert.equal(status().text, t('stateCheckingFiles'));
  lane.sync = 'idle';
  assert.equal(status().text, t('statePreviewReady'));
  lane.connection = 'error';
  assert.equal(status().text, t('stateError'));
  assert.equal(writeNeedsRetry(status()), true);
  lane.connection = 'verify-error';
  assert.equal(status().text, t('stateVerifyError'));
  assert.equal(writeNeedsRetry(status()), true);
});

test('the paired thumbnail signatures use actual component colors, not cached generic swatches', () => {
  const pairs = index.presets.map((card) => ['light', 'dark'].map((v) => {
    const meta = card.variants[v];
    const definition = JSON.parse(readFileSync(new URL(`../../presets/${meta.file}`, import.meta.url), 'utf8'));
    const swatches = cardSwatches({ ...card, themes: { [v]: definition } }, v);
    const vars = themeToCssVariables(parseTheme(definition));
    assert.equal(swatches.bubble, vars['--chat-user-message-bg']);
    assert.equal(swatches.selection, vars['--interactive-selection']);
    assert.equal(swatches.primary, vars['--primary']);
    assert.equal(swatches.syntax[0], vars['--syntax-keyword']);
    return [swatches.primary, swatches.selection, swatches.bubble, ...swatches.syntax.slice(0, 2)];
  }));
  assert.ok(pairs.length >= 9);
  assert.equal(new Set(pairs.map((pair) => JSON.stringify(pair))).size, pairs.length);
});
