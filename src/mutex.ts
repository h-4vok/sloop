import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function withEphemeralMutex<T>(root: string, owner: string, fn: () => T): T {
  const dir = join(root, '.sloop', 'mutex');
  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'active'));
    writeFileSync(join(dir, 'active', 'owner'), owner, { mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('another sloop process holds the local mutex');
  }
  try {
    return fn();
  } finally {
    rmSync(join(dir, 'active'), { recursive: true, force: true });
  }
}

/** Async variant keeps the process-exclusion lease for the complete run. */
export async function withEphemeralMutexAsync<T>(
  root: string,
  owner: string,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = join(root, '.sloop', 'mutex');
  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'active'));
    writeFileSync(join(dir, 'active', 'owner'), owner, { mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error('another sloop process holds the local mutex');
  }
  try {
    return await fn();
  } finally {
    rmSync(join(dir, 'active'), { recursive: true, force: true });
  }
}
