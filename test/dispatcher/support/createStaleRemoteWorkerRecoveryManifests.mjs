import { artifactKey } from '../dispatcher-test-support.mjs';

export const createStaleRemoteWorkerRecoveryManifests = () => {
  const original = createRunManifest('original-run', 'codex/issue-1', 'complete', 4);
  const previous = {
    ...original,
    runId: 'previous-run',
    phase: 'review',
    reviewRound: 3,
    artifacts: [artifactKey('run', { issue: 1, runId: 'previous-run' })],
  };
  const current = createRunManifest('replacement-run', 'codex/issue-1-40ae', 'review', 1);
  return { original, previous, current };
};

function createRunManifest(runId, branch, phase, reviewRound) {
  return {
    protocol: 1,
    runId,
    issue: 1,
    pr: 14,
    branch,
    baseSha: '1234567',
    configFingerprint: 'config-v1',
    phase,
    reviewRound,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId })],
  };
}
