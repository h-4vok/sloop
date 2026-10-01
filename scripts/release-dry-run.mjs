import { deriveReleaseKind, nextVersion, verifyReleaseState } from '../dist/release.js';
import { calculateRelease } from './release-workflow.mjs';

const cases = [
  [['[patch] fix'], '0.1.1', '0.1.2'],
  [['[minor] feature'], '0.1.1', '0.2.0'],
  [['[major] breaking'], '0.9.9', '1.0.0'],
  [['[none] docs'], '0.1.1', '0.2.0'],
  [[], '0.1.1', '0.2.0'],
];
for (const [titles, current, expected] of cases) {
  const result = nextVersion(current, deriveReleaseKind(titles));
  if (result !== expected)
    throw new Error(`${JSON.stringify(titles)}: expected ${expected}, got ${result}`);
  console.log(`${JSON.stringify(titles)} => ${result}`);
}

const released = {
  packageText: '{"version":"0.1.2"}\n',
  changelog: '## 0.1.2 - 2026-10-01\n\n- Merged pull request #113.\n\n# Changelog\n',
};
const retry = await calculateRelease({
  api: { closingIssueTitles: async () => ['[patch] fix'] },
  number: 113,
  body: '',
  tags: ['v0.1.2', 'v0.1.1'],
  readTagMetadata: (tag) => (tag === 'v0.1.2' ? released : null),
  packageVersion: '0.1.2',
});
if (retry.version !== '0.1.2' || !retry.reused)
  throw new Error(`retry advanced the release: ${JSON.stringify(retry)}`);
console.log('retry matching PR => v0.1.2 reused');

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
