import {
  assert,
  test,
  checkoutWorkerBranch,
  dispatch,
  pullRequest,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('recovery explains why an issue is not eligible', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 31,

      status: 'worker_running',

      pr: 54,

      branch: 'codex/issue-31',

      reviewRound: 9,

      workerPid: -1,
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => {
      assert.match(error.message, /Issue #31 cannot be recovered/);
      assert.match(error.message, /Automation Ready/);
      assert.match(error.message, /status=worker_running, pr=54, branch=codex\/issue-31/);
      assert.match(error.message, /gh issue view 31/);
      return true;
    },
  );
});

test('recovery refuses to run Worker against a closed PR', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'closed-pr-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  dispatcherHarness.dependencies.pullRequest = () => ({
    ...dispatcherHarness.pr,

    state: 'CLOSED',
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('recovery refuses to run Worker when the PR has no head branch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'headless-pr-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  let pullRequestCalls = 0;
  dispatcherHarness.dependencies.pullRequest = () => {
    pullRequestCalls += 1;
    return { ...dispatcherHarness.pr, headRefName: undefined };
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.equal(pullRequestCalls, 2);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});
