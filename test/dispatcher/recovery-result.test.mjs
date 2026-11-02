import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RemoteClaim } from '../../src/application/dispatcher/services/recovery/RemoteClaim.js';
import { DispatcherLockRecovery } from '../../src/application/dispatcher/services/recovery/DispatcherLockRecovery.js';

test('remote lease ownership is returned as an expected failure', () => {
  const projection = { openGates: ['lease:owned'] };

  const leaseResult = RemoteClaim.assertRemoteLeaseAvailable(projection);

  assert.equal(leaseResult.ok, false);
  assert.equal(leaseResult.error.exitCode, 3);
  assert.match(leaseResult.error.message, /another dispatcher owns the remote run lease/);
});

test('stale lock recovery returns a live-owner failure without removing the lock', () => {
  let removedLock = false;
  const mockLockIO = {
    exists: () => true,
    read: () => JSON.stringify({ pid: 42 }),
    removeDirectory: () => {
      removedLock = true;
    },
  };

  const recoveryResult = DispatcherLockRecovery.recoverStaleLock(
    mockLockIO,
    'C:/repo',
    (pid) => pid === 42,
  );

  assert.equal(recoveryResult.ok, false);
  assert.equal(recoveryResult.error.exitCode, 3);
  assert.equal(removedLock, false);
});

test('stale lock recovery converts non-Error boundary failures', () => {
  const rawFailure = 'lock inspection failed';
  const mockLockIO = {
    exists: () => {
      throw rawFailure;
    },
    read: () => '',
    removeDirectory: () => {},
  };

  const recoveryResult = DispatcherLockRecovery.recoverStaleLock(
    mockLockIO,
    'C:/repo',
    () => false,
  );

  assert.equal(recoveryResult.ok, false);
  assert.ok(recoveryResult.error instanceof Error);
  assert.equal(recoveryResult.error.message, rawFailure);
});
