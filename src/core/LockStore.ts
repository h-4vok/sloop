import type { LockOwner } from './LockOwner.js';

/** Atomic storage operations for the single-dispatcher lock. */
export interface LockStore {
  tryAcquire(owner: LockOwner): boolean;

  readOwner(): LockOwner;

  tryBeginReclaim(owner: LockOwner): boolean;

  readReclaimOwner(): LockOwner;

  reclaimAgeMs(now: number): number;

  finishReclaim(owner: LockOwner): void;

  abandonReclaim(): void;

  release(token: string): void;
}
