// Research only. Bundle the exact read-only v2.8.0 TS files; do not start OpenChamber.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const UI = 'packages/ui/src';
export const themeDir = `${UI}/lib/theme`;
export const shikiDir = `${UI}/lib/shiki`;

export function researchArgs(args = process.argv.slice(2)) {
  const [arg, ...rest] = args;
  if (!arg || arg.startsWith('-')) throw new Error('用法：bun --no-install <脚本> <v2.8.0 源码绝对路径> [其他参数]');
  const source = resolve(arg);
  if (!existsSync(join(source, themeDir, 'definition.ts'))) throw new Error('找不到上游主题定义');
  return { source, rest };
}

export function readBuiltins(source) {
  const path = join(source, themeDir, 'themes');
  return readdirSync(path).filter((name) => name.endsWith('.json')).sort().map((name) => ({
    name, value: JSON.parse(readFileSync(join(path, name), 'utf8')),
  }));
}

export function researchTemp() {
  return mkdtempSync(join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'theme-studio-research-'));
}

export const MINIMAL = {
  metadata: { id: 'research-only', name: 'Research only', variant: 'light' },
  colors: {
    primary: { base: '#2469b3' },
    surface: { background: '#f2f4f9', foreground: '#16182b', muted: '#d7dfef', mutedForeground: '#4d5266', elevated: '#ffffff' },
    interactive: { border: '#8193ae' },
    status: { error: '#ad2222', warning: '#8a5b00', success: '#006c4d', info: '#0f61a4' },
    syntax: { base: { comment: '#5a6374', keyword: '#772895', string: '#1b6041', number: '#984027', function: '#235d9d', variable: '#573b75', type: '#1c6673', operator: '#82303f' } },
  },
};

function zodLocation(source, stage) {
  const lock = readFileSync(join(source, 'bun.lock'), 'utf8');
  const version = /^\s*"zod": \["zod@([0-9.]+)"/m.exec(lock)?.[1];
  if (!version) throw new Error('无法识别上游锁定的 Zod 版本');
  const cache = process.env.BUN_INSTALL_CACHE_DIR ?? join(homedir(), '.bun', 'install', 'cache');
  const candidates = [
    process.env.THEME_RESEARCH_ZOD_DIR, join(source, UI, '../node_modules/zod'), join(source, 'node_modules/zod'),
    ...(existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith(`zod@${version}@@@`)).sort().map((name) => join(cache, name)) : []),
  ].filter(Boolean);
  const directory = candidates.find((path) => existsSync(join(path, 'package.json'))
    && JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version === version);
  if (!directory) throw new Error(`缺少锁定版本 Zod ${version}；可用 THEME_RESEARCH_ZOD_DIR 指向已解包的该版本包目录`);
  const patch = join(source, `bun-patches/zod@${version}.patch`);
  const unpatched = readFileSync(join(directory, 'v4/core/schemas.js'), 'utf8').includes('if (!isPresent && optin === undefined)');
  if (!existsSync(patch) || !unpatched) return { entry: resolve(directory, 'index.js'), version, patched: existsSync(patch) };
  const overlay = join(stage, 'zod');
  cpSync(directory, overlay, { recursive: true, dereference: true });
  const result = spawnSync('patch', ['--batch', '--silent', '-p1', '-i', patch], { cwd: overlay, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`应用上游锁定的 Zod 补丁失败: ${result.stderr || result.stdout}`);
  return { entry: join(overlay, 'index.js'), version, patched: true };
}

export async function loadUpstream(source) {
  const stage = researchTemp();
  try {
    const zod = zodLocation(source, stage);
    const file = join(stage, 'entry.ts');
    const modules = [
      ['definitions', `${themeDir}/definition.ts`], ['css', `${themeDir}/cssGenerator.ts`],
      ['color', `${themeDir}/color.ts`], ['readable', `${themeDir}/readableColors.ts`],
      ['syntax', `${themeDir}/syntax.ts`], ['terminal', `${UI}/lib/terminalTheme.ts`],
      ['textMate', `${shikiDir}/textMateThemeFromAppTheme.ts`], ['zed', `${shikiDir}/zedThemeFromAppTheme.ts`],
      ['markdown', `${UI}/components/chat/markdown/markdownSyntaxVars.ts`],
    ];
    writeFileSync(file, [
      ...modules.map(([name, path]) => `export * as ${name} from ${JSON.stringify(join(source, path))};`),
      'export { setResearchVSCode } from "@/lib/desktop";',
    ].join('\n'));
    const result = await Bun.build({ target: 'bun', entrypoints: [file], plugins: [{
      name: 'pinned-research-imports',
      setup(build) {
        build.onResolve({ filter: /^zod$/ }, () => ({ path: zod.entry }));
        build.onResolve({ filter: /^@\/lib\/desktop$/ }, () => ({ namespace: 'research', path: 'desktop-runtime' }));
        build.onLoad({ namespace: 'research', filter: /^desktop-runtime$/ }, () => ({
          contents: 'let vscode = false; export const setResearchVSCode = value => { vscode = value; }; export const isVSCodeRuntime = () => vscode;',
        }));
        build.onResolve({ filter: /^@\// }, (args) => ({ path: join(source, UI, args.path.slice(2) + '.ts') }));
      },
    }] });
    const body = await result.outputs[0].text();
    const out = join(stage, 'upstream.js');
    writeFileSync(out, body);
    const loaded = await import(out);
    return { ...loaded, zodVersion: zod.version, zodPatched: zod.patched };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// The audit compares declaration values incl. earlier declarations that may be
// shadowed. A separate read-only scan locates actual consumers.
export function cssDeclarations(css) {
  const values = {};
  for (const line of css.split('\n')) {
    const hit = /^\s*(--[\w-]+): (.*);$/.exec(line);
    if (!hit) continue;
    (values[hit[1]] ??= []).push(hit[2]);
  }
  return values;
}

export function setPath(object, segments, value) {
  let current = object;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}
