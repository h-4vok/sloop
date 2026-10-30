import {
  assert,
  test,
  acquire,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('lock reclaim uses injected storage and process liveness seams', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.now = () => 100;
  dispatcherHarness.dependencies.tryAcquire = () => false;
  dispatcherHarness.dependencies.readOwner = () => ({ pid: 41, createdAt: 0, token: 'old' });
  dispatcherHarness.dependencies.processAlive = (pid) => (calls.push(`processAlive:${pid}`), false);
  dispatcherHarness.dependencies.tryBeginReclaim = (() => {
    let attempt = 0;
    return () => ++attempt > 1;
  })();
  dispatcherHarness.dependencies.readReclaimOwner = () => ({
    pid: 42,

    createdAt: 0,

    token: 'reclaimer',
  });
  dispatcherHarness.dependencies.abandonReclaim = () => calls.push('abandonReclaim');
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  const token = acquire(dispatcherHarness.dependencies, 10);

  assert.match(token, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'processAlive:41',
    'processAlive:42',
    'abandonReclaim',
    'finishReclaim',
  ]);
});
