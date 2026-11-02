import {
  assert,
  test,
  acquire,
  CliFailure,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('dispatcher exhausts lock reclaim attempts when every stale marker reacquire fails', () => {
  const dependencies = createMockDispatcherHarness().dependencies;
  let abandonCount = 0;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => false;
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim marker is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => {
    abandonCount += 1;
  };

  assert.throws(
    () => acquire(dependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
  assert.equal(abandonCount, 3);
});
