import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** Runs one synchronous operation while holding the process-exclusion lease. */
export function withEphemeralMutex<T>(root: string, owner: string, fn: () => T): T {
  const release = createMutexLease(root, owner);

  try {
    return fn();
  } finally {
    release();
  }
}

/** Async variant keeps the process-exclusion lease for the complete run. */
export async function withEphemeralMutexAsync<T>(
  root: string,
  owner: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = createMutexLease(root, owner);

  try {
    return await fn();
  } finally {
    release();
  }
}
