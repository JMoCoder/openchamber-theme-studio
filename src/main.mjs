import { createStudio } from './core/studio.mjs';
import { createSdkHost } from './host/sdk-host.mjs';
import { mountStudio } from './ui/app.mjs';

const host = createSdkHost();
const studio = createStudio({ host });
const root = document.querySelector('#root, #app') ?? document.body;
const view = mountStudio(root, studio);
void studio.start();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void studio.flushDraft();
});
addEventListener('pagehide', (event) => {
  const draft = studio.flushDraft();
  if (event.persisted) return;
  view.dispose();
  studio.dispose();
  void draft.finally(() => host.dispose());
}, { passive: true });
