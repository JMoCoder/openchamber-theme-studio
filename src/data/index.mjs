import builtins from './builtin-index.json' with { type: 'json' };
import fieldCatalog from '../../data/fields.json' with { type: 'json' };
import presetIndex from '../../presets/index.json' with { type: 'json' };
export { presetDefinitions } from './preset-definitions.mjs';

export { builtins, fieldCatalog };
export const presets = presetIndex.presets;
export const builtinCandidates = builtins.flatMap((card) =>
  Object.entries(card.variants).map(([variant, entry]) => ({
    variant, kind: 'builtin', id: entry.id, name: entry.name, key: entry.key, pairId: card.id,
  })));

let pending;
export function loadBuiltinDefinitions(url = './builtins.js') {
  if (globalThis.__themeStudioBuiltins) return Promise.resolve(globalThis.__themeStudioBuiltins);
  if (!globalThis.document) return Promise.reject(new Error('Built-in theme file not loaded'));
  pending ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      script.remove();
      if (globalThis.__themeStudioBuiltins) resolve(globalThis.__themeStudioBuiltins);
      else reject(new Error('Built-in theme file is invalid'));
    };
    script.onerror = () => { script.remove(); reject(new Error('Cannot load built-in theme file')); };
    document.head.append(script);
  }).catch((error) => { pending = undefined; throw error; });
  return pending;
}
