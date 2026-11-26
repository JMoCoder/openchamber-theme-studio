#!/usr/bin/env node
// Contact sheets from untouched OpenChamber screenshots, never mockups.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [source, output] = process.argv.slice(2);
assert(source && output, '用法：node scripts/presets-wall.mjs <隔离抓图目录> <隔离输出目录>');
const photos = realpathSync(source);
const outParent = realpathSync(resolve(output, '..'));
assert(photos.startsWith('/tmp/opencode/') && (outParent === '/tmp/opencode' || outParent.startsWith('/tmp/opencode/')),
  '只读写 /tmp/opencode 下的真机证据');
mkdirSync(output, { recursive: true });
const out = realpathSync(output);
assert(out.startsWith('/tmp/opencode/'), '拒绝写入隔离目录外的文件');
const { presets } = JSON.parse(readFileSync(new URL('../presets/index.json', import.meta.url), 'utf8'));
const font = execFileSync('fc-match', ['--format=%{file}', 'Noto Sans CJK SC'], { encoding: 'utf8' });
const key = {};
for (const mode of ['light', 'dark']) {
  const path = ({ slug }) => join(photos, `${slug}-${mode}-chat.jpg`);
  const common = ['-background', '#6d7077', '-tile', '4x', '-strip'];
  execFileSync('magick', ['montage', '-font', font, '-pointsize', '14', '-fill', '#fcfcfc',
    ...presets.flatMap((p) => ['-label', `${p.rank}  ${p.name.zh}  ${p.name.en}`, path(p)]),
    ...common, '-geometry', '300x196+8+6', '-quality', '90', join(out, `presets-host-wall-11-${mode}.jpg`)]);
  const shuffled = [...presets];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  execFileSync('magick', ['montage', ...shuffled.map(path), ...common,
    '-geometry', '120x80+5+5', join(out, `presets-host-blind-120-${mode}.png`)]);
  key[mode] = shuffled.map(({ slug, name }, i) => ({ position: i + 1, slug, name }));
}
writeFileSync(join(out, 'presets-host-blind-120-key.json'), `${JSON.stringify({
  order: '从左到右、从上到下；每行 4 张', ...key,
}, null, 2)}\n`);
