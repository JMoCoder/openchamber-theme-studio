import { createStudio } from '../src/core/studio.mjs';
import { createMockHost, createMockWorkspace } from '../src/host/mock-host.mjs';
import { problem, slotId, slotPath, themesDir } from '../src/host/library.mjs';

export async function createRealFixture({ locale, mode, scenario, sourceDefinitions }) {
  const workspace = createMockWorkspace({ delay: 85, definitions: sourceDefinitions });
  const selected = ['known', 'legacy-paused'].includes(scenario) ? { light: 'flexoki-light', dark: 'flexoki-dark' } : undefined;
  const host = createMockHost({ workspace, locale, mode, selected, system: mode, granted: scenario !== 'unavailable', oldHost: scenario === 'booting' });
  if (scenario === 'legacy-paused') await host.storage.set('studio:v1:draft', { value: { enabled: false } });
  if (scenario === 'clipboardless') host.writeClipboard = async () => { throw new Error('Fixture clipboard unavailable'); };
  if (scenario === 'read-error') {
    const stat = host.stat;
    let fail = true;
    host.stat = async (path) => {
      if (path === themesDir) {
        if (fail) throw problem('HOST_TIMEOUT', 'Fixture directory reply timed out');
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return stat(path);
    };
    host.control.recoverReads = () => { fail = false; };
  }
  const openStudio = () => createStudio({ host, loadBuiltins: async () => sourceDefinitions, timing: { timeout: 620, debounce: 120 } });
  const studio = openStudio();
  const c = host.control;
  async function setScenario(value) {
    const v = studio.getState().variant;
    if (value === 'active') { await studio.prepareSlot(v); c.select(slotId(v), v); }
    if (value === 'conflict') {
      await setScenario('active');
      const file = c.workspace.files.get(slotPath(v));
      c.editFile(slotPath(v), `${file.content}\n`);
      await studio.apply();
    }
    if (value === 'error') {
      studio.setOverride('colors.primary.base', '#e13287');
      c.failWrite(); await studio.apply();
    }
    if (value === 'unavailable') c.setGranted(false);
    if (value === 'hidden') c.setMode(v === 'light' ? 'dark' : 'light');
  }
  return { studio, openStudio, control: c, readClipboard: c.clipboard, setScenario, setLocale: c.locale };
}
