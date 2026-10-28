import { mkdtempSync, rmSync } from 'node:fs';
import { onTestFinished } from 'vitest';

export function createIsolatedTemporaryDirectory(prefix) {
  const temporaryDirectory = mkdtempSync(prefix);

  onTestFinished(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  return temporaryDirectory;
}
