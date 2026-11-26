// Freeze and recertify only the published fixtures and protected repository
// entrypoints. Never read daily host configuration.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPackage, blob, evidence, file, load, root } from './v-verify-0.3-fixture.mjs';

assert.equal(process.env.V03_ACCEPTANCE_PROFILE, 'rc03d');
const [phase, ...fixtures] = process.argv.slice(2);
assert.ok(phase === 'preflight' || phase === 'finish');
const source = v => join(root, '.dev-host/packages', `i1-${v}`);
const current = assertPackage('rc03d'), previous = assertPackage('rc03c');
assert.equal(current['panel/main.js'], 'a942e0ed15e1a20e28b0aec8649a0b1c35645454c2f2959e600ecda60fb36a70');
assert.equal(current['panel/style.css'], 'ea27f8b620fe9955722af6ff11fca3037cdd4d219b65b8c545a80ee28df4a230');
assert.equal(Object.keys(current).length, 7);
const differences = Object.keys(current).filter(k => current[k] !== previous[k]);
assert.deepEqual(differences, ['panel/main.js']);
const readMain = v => readFileSync(join(source(v), 'panel/main.js'));
const marker = /(?<=\brecoverBuiltin:)("(?:\\.|[^"\\])*")/gu;
const old = readMain('rc03c'), released = readMain('rc03d');
const a = [...old.toString('utf8').matchAll(marker)].map(x => x[0]);
const b = [...released.toString('utf8').matchAll(marker)].map(x => x[0]);
assert.equal(a.length, 2);
assert.equal(b.length, 2);
assert.equal(released.byteLength, 575701);
assert.ok(b.every((value, i) => a[i] !== value && value.includes('（试穿）') && value.includes('(trying on)')));
let occurrence = 0;
assert.ok(Buffer.from(old.toString('utf8').replace(marker, () => b[occurrence++])).equals(released),
  'reconstruct D byte for byte using only the two changed recovery copy literals');
assert.equal(occurrence, 2);

const original = load(join(evidence, 'v03c-v-integrity.json')).protectedRoot;
const rootProtected = Object.fromEntries(Object.keys(original).map(name => {
  const now = file(join(root, name));
  assert.equal(now.sha256, original[name].sha256, name);
  assert.equal(now.mtimeNs, original[name].mtimeNs, name);
  return [name, now];
}));
const snapshots = Object.fromEntries(['rc03', 'rc03b', 'rc03c', 'rc03d'].map(v => {
  const names = assertPackage(v);
  return [v, { manifest: file(join(root, `.dev-host/lead-03/${v}.sha256`)),
    files: Object.fromEntries(Object.keys(names).map(k => [k, file(join(source(v), k))])) }];
}));
const oldEvidence = readdirSync(evidence).filter(p => /^v03(?:b|c)?-/u.test(p)).sort()
  .map(p => [p, blob(readFileSync(join(evidence, p)))]);
const result = {
  candidateBeforeAfterSource: 'frozen seven members and independent fixed D asset hashes',
  packages: snapshots, protectedRoot: rootProtected, priorEvidence: {
    members: oldEvidence.length, sha256: blob(oldEvidence.map(([name, hash]) => `${name}\0${hash}\n`).join('')),
  },
  delta: { from: 'rc03c', to: 'rc03d', identicalMembers: 6, differingMembers: differences,
    exactByteReconstruction: true, onlyTwoRecoverBuiltinLiterals: true, before: a.map(JSON.parse), after: b.map(JSON.parse) },
};
const path = join(evidence, `v03d-v-${phase === 'preflight' ? 'preflight' : 'integrity'}.json`);
if (phase === 'preflight') {
  assert.deepEqual(fixtures, []);
} else {
  assert.ok(fixtures.includes('v03d-v-wrescue') && fixtures.includes('v03d-v-dcross'));
  const first = load(join(evidence, 'v03d-v-preflight.json'));
  assert.deepEqual(result, first, 'no candidate, root, or prior evidence bytes/mtimes changed during this acceptance');
  result.confirmedStoppedByManager = Object.fromEntries(fixtures.map(name => {
    assert.match(name, /^v03d-v-[a-z0-9-]{1,13}$/u);
    const s = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/dev-host.mjs'), 'status', '--name', name], { encoding: 'utf8' }));
    assert.equal(s.running, false);
    assert.equal(s.dir, join(root, '.dev-host/instances', name));
    return [name, s];
  }));
}
writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(path);
