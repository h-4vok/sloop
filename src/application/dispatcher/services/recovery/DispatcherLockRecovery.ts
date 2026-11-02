import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { result, type Result } from '../../../../core/Result.js';
import { CliFailure } from '../../types/CliFailure.js';

/** Injected filesystem operations used to inspect and remove a stale lock. */
export type DispatcherLockRecoveryIO = Readonly<{
  exists(file: string): boolean;

  read(file: string): string;

  removeDirectory(directory: string): void;
}>;

function dispatcherLockPath(rootPath: string): string {
  const key = createHash('sha256').update(rootPath).digest('hex').slice(0, 16);
  return join(tmpdir(), 'sloop-dispatcher', key, 'dispatcher.lock');
}

function recoverStaleLock(
  io: DispatcherLockRecoveryIO,
  rootPath: string,
  processAlive: (pid: number) => boolean,
): Result<string, Error> {
  const lock = dispatcherLockPath(rootPath);
  try {
    if (!io.exists(lock)) return result.success('No dispatcher lock found.');
    return recoverExistingLock(io, lock, processAlive);
  } catch (error) {
    return result.failure(toError(error));
  }
}

function recoverExistingLock(
  io: DispatcherLockRecoveryIO,
  lock: string,
  processAlive: (pid: number) => boolean,
): Result<string, Error> {
  const ownerFile = join(lock, 'owner.json');
  if (!io.exists(ownerFile))
    return result.failure(new Error(`dispatcher lock has no owner file: ${lock}`));
  const ownerResult = readLockOwner(io, ownerFile);
  if (!ownerResult.ok) return ownerResult;
  const { pid } = ownerResult.value;
  if (processAlive(pid))
    return result.failure(
      new CliFailure(3, `dispatcher owner PID ${pid} is still running; lock was not changed`),
    );
  const removalResult = removeLockDirectory(io, lock);
  if (!removalResult.ok) return removalResult;

  return result.success(`Recovered stale dispatcher lock owned by PID ${pid}.`);
}

function removeLockDirectory(io: DispatcherLockRecoveryIO, lock: string): Result<void, Error> {
  try {
    io.removeDirectory(lock);
    return result.success(undefined);
  } catch (error) {
    return result.failure(toError(error));
  }
}

function readLockOwner(
  io: DispatcherLockRecoveryIO,
  ownerFile: string,
): Result<{ pid: number }, Error> {
  let owner: { pid?: number };
  try {
    owner = JSON.parse(io.read(ownerFile));
  } catch {
    return result.failure(
      new Error(`dispatcher lock owner is invalid; inspect manually: ${ownerFile}`),
    );
  }
  if (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0)
    return result.failure(new Error(`dispatcher lock owner has no valid PID: ${ownerFile}`));

  return result.success({ pid: owner.pid });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const DispatcherLockRecovery = {
  dispatcherLockPath,

  recoverStaleLock,
};
