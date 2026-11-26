import { parseTheme } from '../shared/theme-core.mjs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

export const accentOf = (definition) => parseTheme(definition).colors.primary.base;
export const cssAccent = (page) => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary-base').trim());
export const waitAccent = (page, color, timeout = 8500) => page.waitForFunction((expected) =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary-base').trim().toLowerCase() === expected.toLowerCase(),
color, { polling: 75, timeout }).then((handle) => handle.dispose());

export async function enterAppearance(page) {
  const shown = page.getByRole('radio', { name: 'System', exact: true });
  if (await shown.isVisible()) return;
  await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 5000 });
  await page.getByText('Appearance', { exact: true }).first().click({ timeout: 7000 });
  await shown.waitFor({ timeout: 7000 });
}
export async function closeAppearance(page) {
  const shown = page.getByRole('radio', { name: 'System', exact: true });
  if (!await shown.isVisible()) return;
  await page.keyboard.press('Escape');
  const closed = await shown.waitFor({ state: 'hidden', timeout: 800 }).then(() => true, () => false);
  if (!closed) await page.getByRole('button', { name: /close settings/i }).filter({ visible: true }).first()
    .click({ timeout: 2000 }).catch(() => {});
  await shown.waitFor({ state: 'hidden', timeout: 5000 });
}
export const themeRow = (page, id) => page.locator(`[data-theme-id="${id}"]`);
export async function showThemeVariant(page, v) {
  await page.locator(`[data-settings-item="appearance.${v}-theme"]`).click({ timeout: 6000 });
}
export async function observeThemeEvents(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(url)) throw new Error('Use an isolated fixture');
  const timeout = new AbortController();
  const response = await fetch(`${url}/api/openchamber/events`, {
    signal: AbortSignal.any([timeout.signal, AbortSignal.timeout(240_000)]),
  });
  if (!response.ok) throw new Error(`Fixture event stream returned ${response.status}`);
  const receipts = [];
  let buffer = '';
  const reader = response.body.getReader(), decode = new TextDecoder();
  void (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decode.decode(chunk.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        if (buffer.slice(0, end).includes('"type":"openchamber:themes-changed"')) receipts.push(performance.now());
        buffer = buffer.slice(end + 2);
      }
    }
  })().catch(() => {});
  return { count: () => receipts.length, timeAt: (index) => receipts[index], stop: () => timeout.abort() };
}
export async function reloadWithEvents(page) {
  // Synchronize with the host's real EventSource before driving rapid edits.
  // Do not log the event URL: the native client can add a fixture ticket.
  const stream = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/openchamber/events'
    && response.status() === 200, { timeout: 12_000 });
  await Promise.all([stream, page.reload({ waitUntil: 'domcontentloaded' })]);
}
export async function warmFixtureWatcher(state, events) {
  if (!state.openchamberData.includes('/.dev-host/instances/') || !state.defaultDataDir) throw new Error('Use an isolated default-data fixture');
  const marker = join(state.openchamberData, 'themes', 'fixture-unmanaged-e2e-readiness-light.json');
  const tmp = `${marker}.fixture.tmp`;
  const theme = JSON.parse(await readFile(new URL('../presets/tidemark-light.json', import.meta.url), 'utf8'));
  theme.metadata.id = 'fixture-unmanaged-e2e-readiness-light';
  const starting = events.count();
  const observe = async (change) => {
    for (let attempt = 0; attempt < 105; ++attempt) {
      if (events.count() > change) return true;
      await wait(50);
    }
    return false;
  };
  try {
    let witnessed = false;
    for (let attempt = 1; attempt <= 3 && !witnessed; ++attempt) {
      theme.metadata.name = `Fixture readiness ${attempt}`;
      await writeFile(tmp, JSON.stringify(theme));
      await rename(tmp, marker);
      witnessed = await observe(starting);
    }
    if (!witnessed) throw new Error('Native fixture never broadcast the preflight theme write');
    // Keep the unrelated control theme as a byte-for-byte sentinel until the
    // end. Never use preflight changes to cure red tests in the product flow.
    return { path: marker, close: () => rm(marker, { force: true }) };
  } catch (e) {
    await rm(tmp, { force: true });
    await rm(marker, { force: true });
    throw e;
  }
}
export async function removeTheme(page, id) {
  const row = themeRow(page, id);
  await row.getByRole('button', { name: /delete|remove/i }).click();
  const confirmation = page.getByRole('button', { name: /^(delete|remove)$/iu }).filter({ visible: true });
  if (await confirmation.count() === 1) await confirmation.click();
}
