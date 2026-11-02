import { artifactKey } from '../dispatcher-test-support.mjs';

export const createStaleRemoteWorkerRecoveryManifests = () => {
  const original = {
    protocol: 1,

    runId: 'original-run',

    issue: 1,

    pr: 14,

    branch: 'codex/issue-1',

    baseSha: '1234567',

    configFingerprint: 'config-v1',

    phase: 'complete',

    reviewRound: 4,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'original-run' })],
  };
  const previous = {
    ...original,

    runId: 'previous-run',

    phase: 'review',

    reviewRound: 3,

    artifacts: [artifactKey('run', { issue: 1, runId: 'previous-run' })],
  };
  const current = {
    protocol: 1,

    runId: 'replacement-run',

    issue: 1,

    pr: 14,

    branch: 'codex/issue-1-40ae',

    baseSha: '1234567',

    configFingerprint: 'config-v1',

    phase: 'review',

    reviewRound: 1,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'replacement-run' })],
  };
  return { original, previous, current };
};
