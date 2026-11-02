/** Coordinates dispatcher lock acquisition and reclaim operations. */
import { randomUUID } from 'node:crypto';
import { result, type Result } from '../../../../core/Result.js';
import { CliFailure } from '../../types/CliFailure.js';
import type { Deps } from '../../../../application/dispatcher/types/index.js';
import { DispatcherLockRecovery } from './DispatcherLockRecovery.js';
const { dispatcherLockPath, recoverStaleLock } = DispatcherLockRecovery;
type LockOwner = Parameters<Deps['tryAcquire']>[0];

function acquireResult(d: Deps, ttl: number): Result<string, CliFailure> {
  const token = randomUUID();
  const lockOwner = { pid: d.pid(), createdAt: d.now(), token };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (d.tryAcquire(lockOwner)) return result.success(token);
    const reclaimResult = reclaimStaleOwner(d, lockOwner, ttl);
    if (!reclaimResult.ok) return reclaimResult;
    if (reclaimResult.value) return result.success(token);
  }

  return result.failure(alreadyRunningFailure());
}

function reclaimStaleOwner(
  d: Deps,
  lockOwner: LockOwner,
  ttl: number,
): Result<boolean, CliFailure> {
  if (!isStaleOwner(d, ttl)) return result.failure(alreadyRunningFailure());
  const beginResult = beginReclaim(d, lockOwner, ttl);
  if (!beginResult.ok) return beginResult;
  if (!beginResult.value) return result.success(false);

  return result.success(completeReclaim(d, lockOwner));
}

function isStaleOwner(d: Deps, ttl: number): boolean {
  try {
    const owner = d.readOwner();
    return !d.processAlive(owner.pid) && d.now() - owner.createdAt > ttl;
  } catch {
    return true;
  }
}

function beginReclaim(d: Deps, lockOwner: LockOwner, ttl: number): Result<boolean, CliFailure> {
  if (d.tryBeginReclaim(lockOwner)) return result.success(true);
  if (!isStaleReclaimMarker(d, ttl))
    return result.failure(new CliFailure(3, 'another dispatcher is reclaiming the lock'));
  d.abandonReclaim();

  return result.success(d.tryBeginReclaim(lockOwner));
}

function isStaleReclaimMarker(d: Deps, ttl: number): boolean {
  try {
    const marker = d.readReclaimOwner();
    return !d.processAlive(marker.pid) && d.now() - marker.createdAt > ttl;
  } catch {
    return d.reclaimAgeMs(d.now()) > ttl;
  }
}

function completeReclaim(d: Deps, lockOwner: LockOwner): boolean {
  try {
    d.onReclaim();
    d.finishReclaim(lockOwner);
    return true;
  } catch {
    d.abandonReclaim();
    return false;
  }
}

function alreadyRunningFailure(): CliFailure {
  return new CliFailure(3, 'another dispatcher is already running');
}

function acquire(d: Deps, ttl: number): string {
  const acquisitionResult = acquireResult(d, ttl);
  if (!acquisitionResult.ok) throw acquisitionResult.error;

  return acquisitionResult.value;
}

export type { DispatcherLockRecoveryIO } from './DispatcherLockRecovery.js';

export const DispatcherLock = {
  dispatcherLockPath,

  recoverStaleLockResult: recoverStaleLock,

  acquireResult,

  acquire,
};
