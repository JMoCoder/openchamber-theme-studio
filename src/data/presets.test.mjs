import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { presetDefinitions, presets } from './index.mjs';

test('embedded preset pairs decode losslessly from the native theme JSON', () => {
  assert.deepEqual(Object.keys(presetDefinitions), presets.map(({ slug }) => slug));
  for (const { slug, variants } of presets) {
    assert.deepEqual(Object.keys(presetDefinitions[slug]), ['light', 'dark'], slug);
    for (const [variant, { file, id }] of Object.entries(variants)) {
      const source = JSON.parse(readFileSync(new URL(`../../presets/${file}`, import.meta.url), 'utf8'));
      assert.equal(source.metadata.id, id, file);
      assert.deepEqual(presetDefinitions[slug][variant], source, file);
    }
  }
});
