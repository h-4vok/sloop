import {
  assert,
  test,
  command,
  dispatch,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('Arbiter waits for its configured review threshold before intervening', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 3,

      arbiterStagnatingAppearances: 99,

      arbiterCommand: { command: 'codex', args: [] },
    },
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
  assert.equal(
    dispatcherHarness.runs.some((spec) => spec.input?.includes('Use the Arbiter contract')),
    false,
  );
});
