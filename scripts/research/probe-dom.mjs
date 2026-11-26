import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadUpstream, MINIMAL, researchArgs, researchTemp, UI } from './upstream.mjs';

const { source, rest } = researchArgs();
const [distArg, browser = 'google-chrome', ...options] = rest;
if (!distArg || options.some((arg) => arg !== '--write')) {
  throw new Error('用法：bun --no-install scripts/research/probe-dom.mjs <源码> <web-dist> <chromium-executable> [--write]');
}
const dist = resolve(distArg);
const index = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
assert.ok(css.length);
const u = await loadUpstream(source);
const { isSplashColor } = await import(pathToFileURL(join(source, 'packages/electron/remote-page-policy.mjs')).href);
const g = new u.css.CSSVariableGenerator();
const fonts = { sans: '"Research Sans", serif', mono: '"Maple Mono", monospace', heading: '"Research Heading", serif' };
const styles = {};
const themes = {};
for (const mode of ['plain', 'important']) {
  const input = structuredClone(MINIMAL);
  input.colors.chat = { background: '#876543' };
  input.config = {
    fonts: Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, mode === 'important' ? `${v} !important` : v])),
    transitions: { fast: '871ms linear', normal: '1733ms linear', slow: '2842ms linear' },
  };
  themes[mode] = input;
  styles[mode] = g.generate(u.definitions.requireTheme(input));
}
const invalid = structuredClone(MINIMAL);
invalid.config = { fonts: { sans: 'Research; Blocked' } };
assert.equal(u.definitions.themeSchema.safeParse(invalid).success, false);
const colorSamples = [
  '#abc', '#abcd', '#aabbcc', '#aabbcc66', '#12345', '#1234567',
  'rgb(40, 80, 160)', 'rgb(40 80 160 / .4)', 'rgb(20% 40% 60% / 70%)', 'rgba(32.5, 85.5, 170.25, .65)',
  'rgba(40, 80, 160, .4)', 'hsl(214 75% 40%)', 'hwb(213 30% 20%)', 'lab(65 20 -30)', 'lch(63 28 220)',
  'oklab(.67 -.07 -.05)', 'oklch(.67 .14 225)', 'color(display-p3 .16 .62 .87)', 'color-mix(in srgb, #123 35%, #ffc)',
  'light-dark(#eee, #111)', 'rebeccapurple', 'transparent', 'notacolor', 'var(--foreground)',
  'linear-gradient(red, blue)', 'url(example)', 'rgb(400 40 0)',
];
const colors = colorSamples.map((value) => {
  const input = structuredClone(MINIMAL);
  input.colors.syntax.base.keyword = value;
  input.colors.primary.base = value;
  input.colors.surface.muted = value;
  const checked = u.definitions.themeSchema.safeParse(input);
  return {
    value, schema: checked.success, numeric: u.color.toHexColor(value),
    contrast: u.color.contrastRatio(value, '#f2f4f9'),
    ghostty: checked.success ? u.terminal.toGhosttyTheme(u.terminal.convertThemeToXterm(checked.data)).palette[5] : null,
    sidebarRgb: checked.success && g.generate(checked.data).includes('--sidebar-base-rgb:'),
    nativeSplash: isSplashColor(value),
    theme: checked.success ? checked.data : null,
  };
});

const stage = researchTemp();
try {
  const file = join(stage, 'entry.ts');
  const terminal = readFileSync(join(source, UI, 'components/views/TerminalView.tsx'), 'utf8');
  const terminalResolver = /const resolvedFontStack = React\.useMemo\(\(\) => \{([\s\S]*?)\n    \},/.exec(terminal)?.[1]
    ?? /const resolvedFontStack = useMemo\(\(\) => \{([\s\S]*?)\n    \},/.exec(terminal)?.[1];
  assert.ok(terminalResolver, 'TerminalView source changed: update the narrowly extracted callback');
  writeFileSync(file, `
    import { parseTheme, generateThemeCss, themeToCssVariables } from ${JSON.stringify(fileURLToPath(new URL('../../shared/theme-core.mjs', import.meta.url)))};
    import { useAppFontEffects } from ${JSON.stringify(join(source, UI, 'apps/useAppFontEffects.ts'))};
    import { useHostTypography } from ${JSON.stringify(join(source, UI, 'lib/guests/useHostTypography.ts'))};
    import { createAppearanceActions } from ${JSON.stringify(join(source, UI, 'stores/ui/appearanceActions.ts'))};
    import { buildZedThemeFromAppTheme } from ${JSON.stringify(join(source, UI, 'lib/shiki/zedThemeFromAppTheme.ts'))};
    import { useChatWidthAttribute } from ${JSON.stringify(join(source, UI, 'hooks/useChatWidthAttribute.ts'))};
    import { useLayoutAnimationMs } from ${JSON.stringify(join(source, UI, 'hooks/useLayoutAnimationMs.ts'))};
    import { useFontPreferences } from '@/hooks/useFontPreferences';
    import { CODE_FONT_OPTION_MAP, CUSTOM_FONT_ID, DEFAULT_MONO_FONT, customFontStack } from '@/lib/fontOptions';
    const state = { padding: 100, fontSize: 100, cornerRadius: 18 };
    const actions = createAppearanceActions((patch) => Object.assign(state, patch), () => ({ ...state, ...actions }));
    const root = document.documentElement;
    const style = document.getElementById('theme');
    const computed = (id) => getComputedStyle(document.getElementById(id));
    const font = (id) => computed(id).fontFamily;
    const rootProp = (key) => getComputedStyle(root).getPropertyValue(key).trim();
    const preferences = globalThis.themeResearchPrefs = {
      uiFont: 'custom', customUiFont: 'Research UI Preference', monoFont: 'custom', customMonoFont: 'Research Mono Preference',
    };
    const { monoFont, customMonoFont } = useFontPreferences();
    globalThis.themeResearchState = { fontSize: 100, uiFontWeight: 'strong', chatWidth: 'default', layoutAnimations: true };
    const terminalFont = () => { ${terminalResolver} };
    const editor = document.getElementById('editor');
    // Exact inherited CodeMirror declaration from lib/codemirror/flexokiTheme.ts:33;
    // only CSS cascade is under test, not CodeMirror lifecycle.
    editor.style.fontFamily = \`var(--font-mono, \${terminalFont()})\`;
    useAppFontEffects();
    const measurements = {};
    const themeInputs = ${JSON.stringify(themes)};
    const coreBrowserParity = {};
    for (const [mode, declarations] of Object.entries(${JSON.stringify(styles)})) {
      const parsed = parseTheme(themeInputs[mode]);
      coreBrowserParity[mode] = generateThemeCss(parsed) === declarations
        && themeToCssVariables(parsed)['--font-mono'] === ${JSON.stringify(fonts.mono)};
      style.textContent = ':root {\\n' + declarations + '\\n}';
      const guest = useHostTypography();
      measurements[mode] = {
        body: getComputedStyle(document.body).fontFamily, heading: font('heading'), uiUtility: font('ui-font'),
        code: font('code'), editor: font('editor'), terminalFont: terminalFont(), guestFont: guest.font, guestMono: guest.mono,
        rootHeading: rootProp('--font-heading'), bodyWeight: getComputedStyle(document.body).fontWeight,
        linkDuration: computed('settings-link').transitionDuration,
        bodyBackground: getComputedStyle(document.body).backgroundColor, codeBackground: computed('inline-code').backgroundColor,
        radius: rootProp('--radius'), tile: { radius: computed('tile').borderRadius, border: computed('tile').borderWidth, shadow: computed('tile').boxShadow },
      };
    }
    const beforeSpacing = { padding: computed('spaced').paddingTop, lineHeight: rootProp('--line-height-normal'), radius: computed('tile').borderRadius };
    actions.setCornerRadius(0);
    actions.setPadding(160);
    const afterSpacing = { padding: computed('spaced').paddingTop, lineHeight: rootProp('--line-height-normal'), radius: computed('tile').borderRadius };
    const width = {};
    for (const value of ['default', 'wider', 'full']) {
      globalThis.themeResearchState.chatWidth = value;
      useChatWidthAttribute();
      width[value] = { transcript: computed('messages').width, composer: computed('composer').width };
    }
    const enabled = useLayoutAnimationMs();
    globalThis.themeResearchState.layoutAnimations = false;
    const motion = { enabledMs: enabled, disabledMs: useLayoutAnimationMs() };
    const colorSupport = ${JSON.stringify(colors)}.map(({ theme, ...info }) => {
      const browser = CSS.supports('color', info.value);
      const zed = theme ? buildZedThemeFromAppTheme(theme).style.syntax.keyword?.color ?? null : null;
      return { ...info, browser, zed };
    });
    document.getElementById('probe-result').textContent = btoa(unescape(encodeURIComponent(JSON.stringify({
      measurements, spacing: { before: beforeSpacing, after: afterSpacing, storedRadius: state.cornerRadius }, width, motion, colorSupport, coreBrowserParity,
    }))));
  `);
  const mock = {
    react: `module.exports = { useLayoutEffect: (fn) => fn(), useState: (fn) => [fn(), () => {}], useEffect: (fn) => fn() };`,
    useFontPreferences: `export const useFontPreferences = () => globalThis.themeResearchPrefs;`,
    fontLoader: `export const loadMonoFont = () => {}; export const loadUiFont = () => {};`,
    useUIStore: `export const useUIStore = (selector) => selector(globalThis.themeResearchState);`,
  };
  const built = await Bun.build({ target: 'browser', entrypoints: [file], plugins: [{
    name: 'isolated-font-ports',
    setup(build) {
      build.onResolve({ filter: /^(?:react|@\/hooks\/useFontPreferences|@\/lib\/fontLoader|@\/stores\/useUIStore)$/ }, ({ path }) => ({ namespace: 'probe', path: path.split('/').at(-1) }));
      build.onLoad({ namespace: 'probe', filter: /.*/ }, ({ path }) => ({ contents: mock[path] }));
      build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: join(source, UI, path.slice(2) + '.ts') }));
    },
  }] });
  writeFileSync(join(stage, 'probe.js'), await built.outputs[0].text());
  const html = join(stage, 'index.html');
  writeFileSync(html, `<!doctype html><html class="light desktop-runtime"><meta charset="utf-8">
${css.map((file) => `<link rel="stylesheet" href="${pathToFileURL(join(dist, file)).href}">`).join('\n')}
<style id="theme"></style><body><div id="root">
<h1 id="heading">Heading</h1><p id="ui-font" class="font-sans">UI</p><div id="editor" class="cm-editor">Editor</div>
<div class="markdown-content"><code id="inline-code" style="background-color:var(--markdown-inline-code-bg)">Inline</code><pre><code id="code">Code</code></pre></div>
<a id="settings-link" class="typography-settings-link">Settings link</a>
<div id="tile" class="oc-tile rounded-lg border shadow-md">Tile</div><div id="spaced" class="p-4">Padded</div>
<div id="messages" class="chat-message-column">Messages</div><div id="composer" class="chat-input-column">Composer</div>
</div><output id="probe-result"></output><output id="probe-error"></output>
<script>window.addEventListener('error', e => { document.getElementById('probe-error').textContent = e.message || 'script load error'; });</script>
<script type="module" src="probe.js"></script></body></html>`);
  const version = spawnSync(browser, ['--version'], { encoding: 'utf8', timeout: 10_000 }).stdout?.trim();
  const result = spawnSync(browser, [
    '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-features=MediaRouter', '--host-resolver-rules=MAP * ~NOTFOUND',
    '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check',
    '--password-store=basic', '--window-size=1440,900', `--user-data-dir=${join(stage, 'profile')}`, '--dump-dom', pathToFileURL(html).href,
  ], { encoding: 'utf8', timeout: 35_000, env: { ...process.env, HOME: stage, XDG_CONFIG_HOME: stage, XDG_CACHE_HOME: stage } });
  if (result.status !== 0) throw new Error(`Chromium 执行失败：${result.error ?? result.stderr?.split('\n').slice(-7).join('\n')}`);
  const payload = /<output id="probe-result">([A-Za-z0-9+/=]+)<\/output>/.exec(result.stdout)?.[1];
  assert.ok(payload, `Chromium 没有返回探测数据：${/<output id="probe-error">([^<]*)<\/output>/.exec(result.stdout)?.[1] || '无脚本诊断'}`);
  const observed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  const { plain, important } = observed.measurements;
  assert.match(plain.body, /Research UI Preference/);
  assert.match(plain.heading, /Research UI Preference/);
  assert.match(plain.code, /Research Mono Preference/);
  assert.match(important.body, /Research UI Preference/);
  assert.match(important.heading, /Research UI Preference/);
  assert.match(important.rootHeading, /Research Heading/);
  assert.match(important.uiUtility, /Research Sans/);
  assert.match(important.code, /Maple Mono/);
  assert.match(important.editor, /Maple Mono/);
  assert.match(plain.terminalFont, /Research Mono Preference/);
  assert.match(important.terminalFont, /Maple Mono/);
  assert.match(important.guestFont, /Research Sans/);
  assert.match(important.guestMono, /Maple Mono/);
  assert.equal(important.guestMono.includes('!important'), false);
  assert.equal(plain.linkDuration, '0.871s');
  assert.equal(plain.bodyBackground, 'rgb(242, 244, 249)');
  assert.equal(plain.codeBackground, 'rgb(135, 101, 67)');
  assert.equal(observed.spacing.storedRadius, 0);
  assert.equal(observed.spacing.before.radius, observed.spacing.after.radius);
  assert.notEqual(observed.spacing.before.padding, observed.spacing.after.padding);
  assert.notEqual(observed.spacing.before.lineHeight, observed.spacing.after.lineHeight);
  assert.equal(observed.width.default.transcript, '768px');
  assert.equal(observed.width.wider.transcript, '1024px');
  assert.equal(observed.width.full.composer, '1024px');
  assert.ok(parseFloat(observed.width.full.transcript) > 1024);
  assert.deepEqual(observed.motion, { enabledMs: 240, disabledMs: 0 });
  assert.deepEqual(observed.coreBrowserParity, { plain: true, important: true });
  const report = { browser: version, assets: css, methodology: 'isolated file:// test, real installed compiled CSS, real upstream font effects/store actions; callbacks run directly with test preferences; no app instance, pty, or extensions launched', ...observed };
  if (options.includes('--write')) writeFileSync(fileURLToPath(new URL('../../docs/research/evidence/browser-probe.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS · ${version} · ${css.join(', ')} · 字体层叠、对话背景反例、过渡、圆角与密度、${colors.length} 组颜色。`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
