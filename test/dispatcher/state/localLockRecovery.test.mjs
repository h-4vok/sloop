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
  dispatcherLockPath,
  recoverStaleLock,
} from '../support/dispatcher-test-support.mjs';

test('recoverStaleLock removes only a lock owned by a dead process', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.match(
    recoverStaleLock(root, () => false),
    /Recovered stale dispatcher lock/,
  );
  assert.equal(existsSync(lock), false);
  rmSync(root, { recursive: true, force: true });
});

test('recoverStaleLock refuses a live owner', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.throws(
    () => recoverStaleLock(root, () => true),
    (error) => error.exitCode === 3 && /owner PID 9999 is still running/.test(error.message),
  );
  assert.equal(existsSync(lock), true);
  rmSync(root, { recursive: true, force: true });
});
