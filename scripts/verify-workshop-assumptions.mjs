#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openExtension, openFixture } from './dev-browser.mjs';

const name = process.argv[2] ?? 'i1-probe';
const f = await openFixture(name);
try {
  assert.equal(f.state.defaultDataDir, true, 'only the default-data-dir isolated fixture');
  const settings = f.state.openchamberData;
  const home = join(f.state.dir, 'home');
  const themes = '~/.config/openchamber/themes';
  const allowed = `${themes}/theme-studio-fs-check.json`;
  const other = `${themes}/probe-unowned.json`;
  const content = '{"fixture":true}\n';
  const panel = await openExtension(f.page, 'Theme Studio Filesystem Probe');
  await panel.locator('#ready').getByText('ready', { exact: true }).waitFor();
  const run = (type, path, extra) => panel.locator('body').evaluate((_, request) =>
    globalThis.ocFixture.call(request.type, request.payload), { type, payload: { path, ...extra } });
  const result = {};
  const physical = join(settings, 'themes', 'theme-studio-fs-check.json');
  const physicalOther = join(settings, 'themes', 'probe-unowned.json');
  try {
    writeFileSync(physicalOther, content, { flag: 'wx' });
    result.missingTheme = await run('file-stat', allowed);
    result.themeWrite = await run('file-write', allowed, { content });
    result.themeRead = await run('file-read', allowed);
    result.themeStat = await run('file-stat', allowed);
    result.list = await run('file-list', themes);
    result.parentList = await run('file-list', '~/.config/openchamber');
    result.otherRead = await run('file-read', other);
    result.otherWrite = await run('file-write', other, { content: '{}\n' });
    assert.equal(readFileSync(physicalOther, 'utf8'), content);
    assert.equal(readFileSync(physical, 'utf8'), content);
    for (const folder of ['Downloads', '下载']) {
      const physicalDir = join(home, folder);
      const dest = `~/${folder}/openchamber-theme-studio-fs-check.json`;
      const physicalFile = join(physicalDir, 'openchamber-theme-studio-fs-check.json');
      assert.equal(existsSync(physicalDir), false, `run with no fixture ${folder} directory`);
      try {
        result[folder] = {
          parentStatMissing: await run('file-stat', `~/${folder}`),
          fileStatMissingParent: await run('file-stat', dest),
          writeMissingParent: await run('file-write', dest, { content }),
          writeCreatedDirectory: existsSync(physicalDir),
        };
        if (!existsSync(physicalDir)) mkdirSync(physicalDir);
        Object.assign(result[folder], {
          parentStatPresent: await run('file-stat', `~/${folder}`),
          presentWrite: await run('file-write', dest, { content }),
          presentRead: await run('file-read', dest),
          diskMatches: readFileSync(physicalFile, 'utf8') === content,
        });
      } finally {
        rmSync(physicalFile, { force: true });
        if (existsSync(physicalDir)) rmSync(physicalDir, { recursive: true });
      }
    }
  } finally {
    for (const path of [physical, physicalOther]) rmSync(path, { force: true });
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await f.close();
}
