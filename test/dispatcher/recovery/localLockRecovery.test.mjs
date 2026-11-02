import {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  test,
  acquire,
  CliFailure,
  dispatcherLockPath,
  dispatch,
  recoverStaleLock,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('active live run remains exclusive while stale recovery is allowed', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,

      status: 'worker_running',

      workerPid: process.pid,

      workerHeartbeatAt: Date.now(),
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error.exitCode === 3 && /active run exists/.test(error.message),
  );
});

test('stale locks recover safely and reclaim markers are atomic', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.tryAcquire = () => (calls.push('tryAcquire'), false);
  dispatcherHarness.dependencies.readOwner = () => {
    calls.push('readOwner');
    throw new Error('corrupt owner');
  };
  dispatcherHarness.dependencies.tryBeginReclaim = () => (calls.push('tryBeginReclaim'), true);
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  dispatcherHarness.dependencies.onReclaim = () => calls.push('onReclaim');
  const first = acquire(dispatcherHarness.dependencies, 1);

  assert.match(first, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'tryAcquire',
    'readOwner',
    'tryBeginReclaim',
    'onReclaim',
    'finishReclaim',
  ]);
});

test('stale lock recovery validates owner PIDs and removes dead owners', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-owner-'));
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  mkdirSync(lock, { recursive: true });

  try {
    writeFileSync(ownerFile, JSON.stringify({ pid: 0 }));
    assert.throws(() => recoverStaleLock(root), /no valid PID/);

    writeFileSync(ownerFile, JSON.stringify({ pid: 4321 }));
    assert.throws(
      () => recoverStaleLock(root, (pid) => pid === 4321),
      (error) => error instanceof CliFailure && error.exitCode === 3,
    );

    assert.match(
      recoverStaleLock(root, () => false),
      /Recovered stale dispatcher lock/,
    );
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(lock, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher lock acquisition reclaims a stale owner after stale marker recovery', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  let beginCount = 0;
  const dependencies = dispatcherHarness.dependencies;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => {
    calls.push('begin');
    beginCount += 1;
    return beginCount === 2;
  };
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim owner is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => calls.push('abandon');
  dependencies.onReclaim = () => calls.push('reclaim');
  dependencies.finishReclaim = () => calls.push('finish');

  const token = acquire(dependencies, 10);

  assert.equal(typeof token, 'string');
  assert.deepEqual(calls, ['begin', 'abandon', 'begin', 'reclaim', 'finish']);

  const liveOwnerDependencies = createMockDispatcherHarness().dependencies;
  liveOwnerDependencies.tryAcquire = () => false;
  liveOwnerDependencies.readOwner = () => ({ pid: 4321, createdAt: 1000 });
  liveOwnerDependencies.processAlive = () => true;

  assert.throws(
    () => acquire(liveOwnerDependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
});
