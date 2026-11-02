import {
  assert,
  test,
  checkoutWorkerBranch,
  command,
  dispatch,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('failed CI pauses at the review cap instead of launching another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
    ],

    config: { maxReviewRounds: 1 },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().lastCiFeedback, '[CI] pr-checks: FAILURE');
});

test('escalated Arbiter findings move the run to human review without another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - unresolved contract finding',
    ],

    arbiterAction: 'escalate',

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterCommand: { command: 'codex', args: [] },
    },
  });

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'human_review_required');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
});

test('dispatcher pauses an over-budget recovery before launching a replacement Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'over-budget-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 3,
    },

    config: { maxReviewRounds: 1 },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('[HITL Review Cap]')),
    true,
  );
});
