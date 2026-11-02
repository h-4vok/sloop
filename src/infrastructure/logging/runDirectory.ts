import { join } from 'node:path';

/** Builds the private evidence directory path for one issue run. */
export function runDirectory(root: string, issue: number, runId: string, at = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '_');

  return join(root, '.sloop', 'runs', `${stamp}-issue-${issue}-${safeRunId}`);
}
