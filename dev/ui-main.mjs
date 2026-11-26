import { createFakeStudio } from './ui-fake-studio.mjs';
import fieldCatalog from '../data/fields.json' with { type: 'json' };
import presetIndex from '../presets/index.json' with { type: 'json' };
import { mountStudio } from '../src/ui/app.mjs';

const q = new URLSearchParams(location.search);
const sourceDefinitions = JSON.parse(document.getElementById('fixtures').textContent);
const fixtureDefinitions = JSON.parse(document.getElementById('presets').textContent);
const builtinIndex = JSON.parse(document.getElementById('builtin-index').textContent);
const frames = [];
const frameMark = (duration) => frames.push(duration);
const locale = q.get('locale') || 'en', mode = q.get('mode') || 'light', scenario = q.get('scenario') || 'off';
const mockCore = q.get('core') === 'real';
const presets = presetIndex.presets.map((card) => ({ ...card, themes: fixtureDefinitions[card.slug] }));
const devState = {
  presets,
  builtins: builtinIndex.length ? builtinIndex.map((card) => ({ ...card, themes: Object.fromEntries(Object.entries(card.variants)
    .map(([v, entry]) => [v, sourceDefinitions[entry.id]])) })) : presets.slice(1, 4).map((item) => ({ ...item, id: item.slug })),
  fields: fieldCatalog,
};
const realRig = mockCore ? await import('/fixture-real.js').then((module) => module.createRealFixture({ locale, mode, scenario, sourceDefinitions })) : null;
let studio = realRig?.studio ?? createFakeStudio(devState, { locale, mode, scenario, variant: q.get('variant') || mode });
const root = document.getElementById('root');
let mounted = mountStudio(root, studio, { onFrame: frameMark });
await studio.start();
if (q.get('preview') === 'hide') studio.setUiPreferences({ previewCollapsed: true });
window.__uiDev = {
  studio, frames,
  ...(realRig ? {
    control: realRig.control, setScenario: realRig.setScenario, setLocale: realRig.setLocale, readClipboard: realRig.readClipboard,
    async reopen({ afterUninstall = false } = {}) {
      await studio.flushDraft();
      mounted.dispose(); studio.dispose();
      if (afterUninstall) realRig.control.workspace.uninstall();
      studio = window.__uiDev.studio = realRig.openStudio();
      mounted = mountStudio(root, studio, { onFrame: frameMark });
      await studio.start();
    },
  } : { readClipboard: () => studio.test.readClipboard(), setScenario: studio.test.setScenario, setLocale: studio.test.setLocale }),
};
requestAnimationFrame(() => requestAnimationFrame(() => {
  performance.mark('studio-first-ready');
  root.dataset.ready = 'true';
}));
