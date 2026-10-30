import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('recovery rejects a conflicting persisted branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'main',

      status: 'worker_running',

      workerRunId: 'corrupt-recovery-state',

      workerPid: -1,

      workerStartedAt: now - 1000,

      workerHeartbeatAt: now - 1000,

      workerRecoveryCount: 0,

      reviewRound: 1,

      completedIssues: [],

      drainStatus: 'running',

      updatedAt: now,
    },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch main; found codex\/issue-1/,
  );
});
