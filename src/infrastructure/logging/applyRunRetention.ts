import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Removes expired run directories only when an explicit retention is set. */
export function applyRunRetention(root: string, retentionMs?: number, now = Date.now()): void {
  if (retentionMs === undefined) return;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0)
    throw new Error('retentionMs must be non-negative');
  const runs = join(root, '.sloop', 'runs');
  if (!existsSync(runs)) return;

  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    const stamp = entry.name.match(/^(\d{8}T\d{6}Z)/)?.[1];
    const parsed = stamp
      ? Date.parse(
          stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6.000Z'),
        )
      : NaN;
    if (entry.isDirectory() && Number.isFinite(parsed) && now - parsed > retentionMs)
      rmSync(join(runs, entry.name), { recursive: true, force: true });
  }
}
