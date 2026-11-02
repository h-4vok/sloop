import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { DispatcherLockRecoveryIO } from '../../application/dispatcher/services/recovery/DispatcherLockRecovery.js';

/** Adapts Node filesystem operations to the injected stale-lock recovery port. */
export function createNodeDispatcherLockRecoveryIO(): DispatcherLockRecoveryIO {
  return {
    exists: existsSync,

    read: (file) => readFileSync(file, 'utf8'),

    removeDirectory: (directory) => rmSync(directory, { recursive: true, force: true }),
  };
}
