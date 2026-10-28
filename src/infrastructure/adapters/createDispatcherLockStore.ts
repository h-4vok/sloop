import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockOwner, LockStore } from '../../core/boundaries.js';
import { dispatcherLockPath } from '../../dispatcher.js';

function writeLockOwner(file: string, owner: LockOwner): void {
  writeFileSync(file, JSON.stringify(owner, null, 2) + '\n');
}

/** Creates the filesystem-backed lock store used by the single dispatcher. */
export const dispatcherLockStoreFactory = Object.freeze({
  create(root: string): LockStore {
    const lockDirectory = dispatcherLockPath(root);
    const ownerFile = join(lockDirectory, 'owner.json');
    const reclaimDirectory = join(lockDirectory, 'reclaiming');
    const reclaimOwnerFile = join(reclaimDirectory, 'owner.json');

    return {
      tryAcquire: (owner) => {
        mkdirSync(join(lockDirectory, '..'), { recursive: true });
        try {
          mkdirSync(lockDirectory);
          writeLockOwner(ownerFile, owner);

          return true;
        } catch {
          return false;
        }
      },

      readOwner: () => JSON.parse(readFileSync(ownerFile, 'utf8')) as LockOwner,

      tryBeginReclaim: (owner) => {
        try {
          mkdirSync(reclaimDirectory);
          writeLockOwner(reclaimOwnerFile, owner);

          return true;
        } catch {
          return false;
        }
      },

      readReclaimOwner: () => JSON.parse(readFileSync(reclaimOwnerFile, 'utf8')) as LockOwner,

      reclaimAgeMs: (now) => now - statSync(reclaimDirectory).mtimeMs,

      finishReclaim: (owner) => {
        writeLockOwner(ownerFile, owner);
        rmSync(reclaimDirectory, { recursive: true, force: true });
      },

      abandonReclaim: () => rmSync(reclaimDirectory, { recursive: true, force: true }),

      release: (token) => {
        try {
          const owner = JSON.parse(readFileSync(ownerFile, 'utf8')) as LockOwner;
          if (owner.token === token) rmSync(lockDirectory, { recursive: true, force: true });
        } catch {
          /* The lock may have been reclaimed before release. */
        }
      },
    };
  },
});
