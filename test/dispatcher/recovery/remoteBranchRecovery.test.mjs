import {
  assert,
  test,
  checkoutWorkerBranch,
  dispatch,
  prepareWorkerBranch,
  prepareRecovery,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';
import { DispatchWorkspace } from '../../../src/application/dispatcher/services/DispatchWorkspace.js';

test('recovery adopts the open PR branch when persisted branch is absent', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 1,

      pr: 14,

      status: 'worker_recovery_pending',

      workerRunId: 'recovery-test',
    },
  });

  await DispatchWorkspace.prepareRecoveryWorker(
    dispatcherHarness.cfg,
    dispatcherHarness.dependencies,
    { number: 1, title: 'one' },
    undefined,
    undefined,
  );

  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().headSha, 'abc0');
});

test('recovery detects stale Worker state, starts a new Worker and reuses the existing PR', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      now,
      100,
    ),
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('recovery must reuse the existing branch');
  };
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(checkedOut, 'codex/issue-1');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('Worker perdido')),
    true,
  );
});
