import {
  assert,
  test,
  dispatch,
  resetRunState,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('no-work done state clears all prior run context', async () => {
  const dispatcherHarness = createNoWorkHarness();

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(
    dispatcherHarness.state(),
    expectedDoneState(dispatcherHarness.state().updatedAt),
  );
});

function createNoWorkHarness() {
  const dispatcherHarness = createMockDispatcherHarness([], { initialState: priorRunState() });
  dispatcherHarness.setState({
    completedIssues: [8],
    mainGreen: true,
    status: undefined,
    issue: undefined,
    pr: undefined,
    branch: undefined,
  });

  return dispatcherHarness;
}

function priorRunState() {
  return {
    issue: 9,
    status: 'blocked',
    pr: 14,
    branch: 'codex/issue-9',
    headSha: 'old-head',
    mainBaseSha: 'old-main',
    reviewRound: 4,
    lastCiFeedback: 'old CI',
    lastQaFeedback: 'old QA',
    lastStaffFeedback: 'old Staff',
    taskContext: 'old context',
    workerRunId: 'old-run',
    workerPid: 123,
    workerStartedAt: 1,
    workerHeartbeatAt: 1,
    workerRecoveryCount: 2,
    lastError: 'old error',
    completedIssues: [8],
    mainGreen: true,
  };
}

function expectedDoneState(updatedAt) {
  return {
    completedIssues: [8],
    mainGreen: true,
    status: 'done',
    drainStatus: 'done',
    updatedAt,
  };
}

test('resetRunState clears stale run context and preserves completed issues', () => {
  const state = resetRunState(
    {
      issue: 21,

      pr: 20,

      branch: 'codex/issue-3',

      status: 'worker_recovery_pending',

      workerPid: -1,

      completedIssues: [1, 2, 3],

      mainGreen: true,

      lastError: 'stale worker',
    },
    () => false,
  );

  assert.deepEqual(state.completedIssues, [1, 2, 3]);
  assert.equal(state.status, undefined);
  assert.equal(state.pr, undefined);
  assert.equal(state.branch, undefined);
  assert.equal(state.lastError, undefined);
  assert.equal(state.drainStatus, 'running');
});

test('resetRunState refuses a live Worker', () => {
  assert.throws(
    () => resetRunState({ status: 'worker_running', workerPid: 123 }, () => true),
    /cannot reset while Worker process 123 is still running/,
  );
});
