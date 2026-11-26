#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const flags = process.argv.slice(2);
if (flags.length !== 0 && (flags.length !== 2 || flags[0] !== '--fixture' || !/^i1-[a-z0-9-]{1,36}$/u.test(flags[1]))) {
  throw new Error('用法：node scripts/build.mjs [--fixture i1-独立名称]');
}
if (!globalThis.Bun) {
  const status = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', cwd: root });
  if (status.error) throw new Error('构建需要 Bun。', { cause: status.error });
  process.exitCode = status.status ?? 1;
} else {
  await import('./gen-presets-data.mjs');
  if (!existsSync(join(root, 'panel/builtins.js'))) throw new Error('请先运行 scripts/gen-builtins.mjs。');
  const roots = [root, join(root, '.dev-host/runtime/deps')];
  let sdk;
  for (const directory of roots) {
    try { sdk = createRequire(join(directory, 'package.json')).resolve('@openchamber/sdk'); break; } catch {}
  }
  if (!sdk) throw new Error('请预装清单锁定的 @openchamber/sdk@2.8.0，或先启动一次隔离宿主。');
  const pkg = await Bun.file(join(dirname(sdk), '../package.json')).json();
  if (pkg.version !== '2.8.0') throw new Error(`需要 @openchamber/sdk@2.8.0，实际 ${pkg.version}`);
  const result = await Bun.build({
    entrypoints: [join(root, 'src/main.mjs')],
    naming: 'main.js',
    target: 'browser',
    format: 'iife',
    minify: true,
    splitting: false,
    plugins: [{ name: 'pin-openchamber-sdk', setup(builder) {
      builder.onResolve({ filter: /^@openchamber\/sdk$/u }, () => ({ path: sdk }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  if (result.outputs.length !== 1) throw new Error('构建未生成单一主脚本');
  const [bundle] = result.outputs;
  const size = bundle.size;
  if (size > 600_000) throw new Error(`主脚本 ${size} B 超过 600 KB`);
  let project = root;
  if (flags.length === 2) {
    project = join(root, '.dev-host/packages', flags[1]);
    mkdirSync(join(project, 'panel'), { recursive: true, mode: 0o700 });
    if (realpathSync(join(project, 'panel')) !== join(project, 'panel')) throw new Error('拒绝经符号链接写试件');
    for (const file of ['package.json', 'LICENSE', 'NOTICE.md', 'panel/index.html', 'panel/style.css', 'panel/builtins.js']) {
      copyFileSync(join(root, file), join(project, file));
    }
  }
  const path = join(project, 'panel/main.js');
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, bundle);
  renameSync(tmp, path);
  console.log(`panel/main.js ${size} B（单 IIFE）；panel/builtins.js ${statSync(join(root, 'panel/builtins.js')).size} B（按需加载）`);
  if (flags.length) console.log(`隔离安装目录：${project}`);
}
