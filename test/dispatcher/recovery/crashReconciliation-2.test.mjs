import {
  assert,
  test,
  checkoutWorkerBranch,
  dispatch,
  artifactKey,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('dispatcher continues when remote claim failure is reconciled by its artifact marker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  let claimAttempts = 0;
  let reconciliations = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({ issue: 1, markers: [] }),

    claim: () => {
      claimAttempts += 1;
      throw new Error('remote claim response was lost');
    },

    reconcile: () => {
      reconciliations += 1;
      return true;
    },

    publish: () => {},
  };

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(claimAttempts, 1);
  assert.equal(reconciliations >= 1, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher continues when failed remote publication is reconciled', async () => {
  const { dispatcherHarness, published } = createPublicationRecoveryHarness();

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(published.length > 0, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

function createPublicationRecoveryHarness() {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'remote-recovery-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,
    runId: 'remote-recovery-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1',
    baseSha: 'abc1234',
    configFingerprint: 'config-v1',
    phase: 'blocked',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-recovery-run' })],
  };
  const published = [];
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      issue: 1,
      pr: 14,
      prState: 'OPEN',
      branch: 'codex/issue-1',
      manifest,
      markers: ['sloop/v1/run/remote-recovery-run'],
    }),
    claim: () => assert.fail('existing remote run must not be claimed again'),
    reconcile: () => true,
    publish: () => {
      published.push('attempted');
      throw new Error('remote publication response was lost');
    },
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  return { dispatcherHarness, published };
}
