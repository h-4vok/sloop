import {
  assert,
  test,
  checkoutWorkerBranch,
  dispatch,
  prepareWorkerBranch,
  prepareRecovery,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('recovery with a stale remote branch adopts the existing PR branch and reaches QA', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    headRefName: 'codex/issue-1-137e',

    initialState: {
      issue: 1,

      pr: 14,

      status: 'worker_recovery_pending',

      reviewRound: 4,

      workerPid: -1,

      workerStartedAt: now - 101,

      workerHeartbeatAt: now - 101,
    },
  });
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,

      issue: 1,

      pr: 14,

      manifest: {
        protocol: 1,

        runId: 'recovery-run',

        issue: 1,

        pr: 14,

        branch: 'codex/issue-1-stale',

        baseSha: 'abcdef1',

        configFingerprint: 'test-config',

        phase: 'working',

        reviewRound: 4,

        contextCursor: '',

        artifacts: ['sloop-v1/run/recovery-artifact'],
      },

      markers: ['sloop/v1/run/recovery-run'],
    }),

    reconcile: () => true,

    claim: () => {},

    publish: () => {},
  };
  let prepared = 0;
  let checkedOut;
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    prepared += 1;
    throw new Error('must not create a second branch for an existing PR');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(prepared, 0);
  assert.equal(checkedOut, 'codex/issue-1-137e');
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().reviewRound, 4);
});

test('recovery accepts a collision-suffixed Worker branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1-071f' },
      1,
      14,
      now,
      100,
    ),
  });
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(checkedOut, 'codex/issue-1-071f');
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
});
