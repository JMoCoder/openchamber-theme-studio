import { createStudio } from '../src/core/studio.mjs';
import { loadBuiltinDefinitions } from '../src/data/index.mjs';
import { createMockHost } from '../src/host/mock-host.mjs';
import { slotId, slotPath } from '../src/host/library.mjs';
import { mountStudio } from '../src/ui/app.mjs';

const scenario = new URLSearchParams(location.search).get('scenario');
const host = createMockHost({ locale: navigator.language, granted: scenario !== 'no-grant', oldHost: scenario === 'old' });
const { control } = host;
const studio = createStudio({ host, loadBuiltins: () => loadBuiltinDefinitions('../panel/builtins.js') });
mountStudio(document.getElementById('app'), studio);
void studio.start();
let held = false;
document.getElementById('dev-controls').onclick = ({ target }) => {
  const v = studio.getState().host.mode;
  switch (target.dataset.fixture) {
    case 'scheme': control.setSystem(v === 'light' ? 'dark' : 'light'); break;
    case 'builtin': control.select(`openchamber-${v}`, v); break;
    case 'slot': control.select(slotId(v), v); break;
    case 'custom': {
      const base = structuredClone(studio.getState().resolved[v]);
      base.metadata.id = `fixture-custom-${v}`;
      base.colors.primary.base = '#228760';
      control.workspace.addTheme(base);
      control.select(base.metadata.id, v);
      break;
    }
    case 'fail': control.failWrite(); break;
    case 'hold': held ? control.release() : control.hold(); held = !held; break;
    case 'conflict': {
      const file = control.workspace.files.get(slotPath(v));
      if (file) control.editFile(slotPath(v), `${file.content} `);
      break;
    }
  }
};
