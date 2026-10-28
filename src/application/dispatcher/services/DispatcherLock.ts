/** Coordinates dispatcher lock operations for dispatcher workflows. */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { CliFailure } from '../types/CliFailure.js';
import type { Deps } from '../../../application/dispatcher/types/index.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { RunStatePolicy } from './RunStatePolicy.js';
const { defaultProcessAlive } = RunStatePolicy;

function dispatcherLockPath(rootPath: string): string {
  const key = createHash('sha256').update(rootPath).digest('hex').slice(0, 16);
  return join(tmpdir(), 'sloop-dispatcher', key, 'dispatcher.lock');
}

function recoverStaleLock(rootPath = defaultRoot, processAlive = defaultProcessAlive): string {
  const lock = dispatcherLockPath(rootPath);
  if (!existsSync(lock)) return 'No dispatcher lock found.';
  const ownerFile = join(lock, 'owner.json');
  if (!existsSync(ownerFile)) throw new Error(`dispatcher lock has no owner file: ${lock}`);
  let owner: { pid?: number };
  try {
    owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  } catch {
    throw new Error(`dispatcher lock owner is invalid; inspect manually: ${ownerFile}`);
  }
  const pid = owner.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
    throw new Error(`dispatcher lock owner has no valid PID: ${ownerFile}`);
  if (processAlive(pid))
    throw new CliFailure(3, `dispatcher owner PID ${pid} is still running; lock was not changed`);
  rmSync(lock, { recursive: true, force: true });
  return `Recovered stale dispatcher lock owned by PID ${pid}.`;
}

function acquire(d: Deps, ttl: number): string {
  const token = randomUUID();
  const lockOwner = { pid: d.pid(), createdAt: d.now(), token };
  for (let attempt = 0; attempt < 3; attempt++)
    if (d.tryAcquire(lockOwner)) return token;
    else {
      let stale = false;
      try {
        const owner = d.readOwner();
        stale = !d.processAlive(owner.pid) && d.now() - owner.createdAt > ttl;
      } catch {
        stale = true;
      }
      if (stale) {
        if (!d.tryBeginReclaim(lockOwner)) {
          let markerStale = false;
          try {
            const marker = d.readReclaimOwner();
            markerStale = !d.processAlive(marker.pid) && d.now() - marker.createdAt > ttl;
          } catch {
            markerStale = d.reclaimAgeMs(d.now()) > ttl;
          }
          if (!markerStale) throw new CliFailure(3, 'another dispatcher is reclaiming the lock');
          d.abandonReclaim();
          if (!d.tryBeginReclaim(lockOwner)) continue;
        }
        try {
          d.onReclaim();
          d.finishReclaim(lockOwner);
          return token;
        } catch {
          d.abandonReclaim();
          continue;
        }
      } else throw new CliFailure(3, 'another dispatcher is already running');
    }
  throw new CliFailure(3, 'another dispatcher is already running');
}

export const DispatcherLock = {
  dispatcherLockPath,
  recoverStaleLock,
  acquire,
};
