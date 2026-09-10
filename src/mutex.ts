import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function withEphemeralMutex<T>(root: string, owner: string, fn: () => T): T {
  const dir = join(root, '.sloop', 'mutex');
  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'active'));
    writeFileSync(join(dir, 'active', 'owner'), owner, { mode: 0o600 });
  } catch {
    throw new Error('another sloop process holds the local mutex');
  }
  try {
    return fn();
  } finally {
    rmSync(join(dir, 'active'), { recursive: true, force: true });
  }
}
