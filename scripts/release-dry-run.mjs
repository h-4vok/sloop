import { parseReleaseKind, nextVersion, verifyReleaseState } from '../dist/release.js';

const cases = [
  ['[patch] fix', '0.1.1', '0.1.2'],
  ['[minor] feature', '0.1.1', '0.2.0'],
  ['[major] breaking', '0.9.9', '1.0.0'],
  ['[none] docs', '0.1.1', null],
];
for (const [title, current, expected] of cases) {
  const kind = parseReleaseKind(title);
  const result = kind === 'none' ? null : nextVersion(current, kind);
  if (result !== expected) throw new Error(`${title}: expected ${expected}, got ${result}`);
  console.log(`${title} => ${result ?? 'no release'}`);
}
for (const title of ['fix', '[patch] [minor] ambiguous']) {
  try {
    parseReleaseKind(title);
    throw new Error(`${title}: accepted unexpectedly`);
  } catch (error) {
    if (!String(error.message).includes('exactly one')) throw error;
    console.log(`${title} => rejected`);
  }
}
const state = {
  tagName: 'v0.1.2',
  tagTarget: 'abc123',
  releaseTagName: 'v0.1.2',
  releaseTarget: 'abc123',
};
verifyReleaseState(state, 'v0.1.2', 'abc123');
console.log('retry matching tag/release => reused');
try {
  verifyReleaseState({ ...state, releaseTarget: 'wrong-target' }, 'v0.1.2', 'abc123');
  throw new Error('inconsistent retry accepted');
} catch (error) {
  if (!String(error.message).includes('does not match')) throw error;
  console.log('retry inconsistent release => rejected');
}
