import {
  assert,
  test,
  dispatch,
  artifactKey,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('prepared remote recovery rejects a manifest branch mismatch', async () => {
  const dispatcherHarness = createBranchMismatchRecoveryHarness();

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /manifest branch/);
});

function createBranchMismatchRecoveryHarness() {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 7,
    initialState: {
      issue: 1,
      pr: 7,
      branch: 'codex/issue-1',
      status: 'worker_recovery_pending',
      workerRunId: 'prepared-run',
      preparedRecovery: true,
      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,
    runId: 'prepared-run',
    issue: 1,
    branch: 'codex/issue-99',
    baseSha: 'abc1234',
    configFingerprint: 'config-v1',
    phase: 'blocked',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'prepared-run' })],
  };
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,
      issue: 1,
      pr: 7,
      prState: 'OPEN',
      branch: 'pending',
      manifest,
      markers: ['sloop/v1/run/prepared-run'],
    }),
    reconcile: () => true,
    claim: () => {},
    publish: () => {},
  };

  return dispatcherHarness;
}
