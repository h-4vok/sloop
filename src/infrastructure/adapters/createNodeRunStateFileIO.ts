import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import type { RunStateFileIO } from '../../application/dispatcher/services/state/RunStateStore.js';

/** Adapts Node filesystem operations to the injected local state-store port. */
export function createNodeRunStateFileIO(): RunStateFileIO {
  return {
    exists: existsSync,

    read: (file) => readFileSync(file, 'utf8'),

    makeDirectory: (directory) => mkdirSync(directory, { recursive: true }),

    write: (file, contents) => writeFileSync(file, contents),

    rename: renameSync,
  };
}
