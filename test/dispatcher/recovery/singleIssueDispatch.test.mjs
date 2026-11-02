import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('dispatcher stops after one issue instead of draining the queue', async () => {
  const dispatcherHarness = createMockDispatcherHarness([
    { number: 1, title: 'first' },
    { number: 2, title: 'second' },
  ]);
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(dispatcherHarness.state().completedIssues, [1]);
});
