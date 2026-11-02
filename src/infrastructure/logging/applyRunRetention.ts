import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Removes expired run directories only when an explicit retention is set. */
export function applyRunRetention(root: string, retentionMs?: number, now = Date.now()): void {
  if (retentionMs === undefined) return;
  validateRetention(retentionMs);
  const runsDirectory = join(root, '.sloop', 'runs');
  if (!existsSync(runsDirectory)) return;
  for (const entry of readdirSync(runsDirectory, { withFileTypes: true }))
    removeExpiredRun(runsDirectory, entry, retentionMs, now);
}

function validateRetention(retentionMs: number): void {
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0)
    throw new Error('retentionMs must be a non-negative integer');
}

function removeExpiredRun(
  runsDirectory: string,
  entry: { name: string; isDirectory(): boolean },
  retentionMs: number,
  now: number,
): void {
  const timestamp = runTimestamp(entry.name);
  if (entry.isDirectory() && timestamp !== undefined && now - timestamp > retentionMs)
    rmSync(join(runsDirectory, entry.name), { recursive: true, force: true });
}

function runTimestamp(name: string): number | undefined {
  const stamp = name.match(/^(\d{8}T\d{6}Z)/)?.[1];
  if (!stamp) return undefined;
  const timestamp = Date.parse(
    stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6.000Z'),
  );
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
