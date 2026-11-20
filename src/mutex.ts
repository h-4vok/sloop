import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { result, type Result } from './core/Result.js';

const positiveIssueNumberPattern = /^\d+$/;
const positiveProcessIdPattern = /^[1-9]\d*$/;

function createMutexLease(root: string, owner: string): () => void {
  const activeDirectory = join(root, '.sloop', 'mutex', 'active');

  try {
    mkdirSync(join(root, '.sloop', 'mutex'), { recursive: true });
    mkdirSync(activeDirectory);
    writeFileSync(join(activeDirectory, 'owner'), owner, { mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('another sloop process holds the local mutex');
  }

  return () => rmSync(activeDirectory, { recursive: true, force: true });
}

// Owns the repository-local process-exclusion lease and its explicit reset.
export const ephemeralMutex = Object.freeze({
  run<T>(root: string, owner: string, action: () => T): T {
    const release = createMutexLease(root, owner);

    try {
      return action();
    } finally {
      release();
    }
  },

  async runAsync<T>(root: string, owner: string, action: () => Promise<T>): Promise<T> {
    const release = createMutexLease(root, owner);

    try {
      return await action();
    } finally {
      release();
    }
  },

  reset(root: string, processAlive: (pid: number) => boolean): Result<string, string> {
    const mutexDirectory = join(root, '.sloop', 'mutex');
    if (!existsSync(mutexDirectory)) return result.success('No repository mutex found.');

    const activeDirectory = join(mutexDirectory, 'active');
    if (existsSync(activeDirectory)) {
      const ownerPath = join(activeDirectory, 'owner');
      if (!existsSync(ownerPath))
        return result.failure('Cannot reset the repository mutex because its owner is unknown.');

      const ownerFields = readFileSync(ownerPath, 'utf8').trim().split(':');
      const ownerPid = Number(ownerFields[0]);
      if (
        ownerFields.length !== 2 ||
        !positiveProcessIdPattern.test(ownerFields[0]!) ||
        !Number.isSafeInteger(ownerPid) ||
        !positiveIssueNumberPattern.test(ownerFields[1]!)
      )
        return result.failure('Cannot reset the repository mutex because its owner is invalid.');

      if (processAlive(ownerPid))
        return result.failure(
          `Cannot reset the repository mutex while Sloop process ${ownerPid} is active.`,
        );
    }

    rmSync(mutexDirectory, { recursive: true, force: true });

    return result.success('Repository mutex reset.');
  },
});
