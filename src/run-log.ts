import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
export type RunEvent = Readonly<{ at: string; type: string; data?: unknown }>;
export function runDirectory(root: string, issue: number, runId: string, at = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(root, '.sloop', 'runs', `${stamp}-issue-${issue}-${safe}`);
}
export class RunLogger {
  readonly file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'events.jsonl');
    const fd = openSync(this.file, 'a', 0o600);
    closeSync(fd);
    chmodSync(this.file, 0o600);
  }
  write(type: string, data?: unknown): void {
    const event: RunEvent = {
      at: new Date().toISOString(),
      type,
      ...(data === undefined ? {} : { data }),
    };
    appendFileSync(this.file, JSON.stringify(event) + '\n', { mode: 0o600 });
  }
  command(command: string, stdout: string, stderr: string, cwd: string): void {
    this.write('command', { command, stdout, stderr, cwd });
  }
  stream(source: 'stdout' | 'stderr' | 'codex', chunk: string): void {
    this.write(source, chunk);
  }
}
/** Retention is opt-in; omitted/undefined deliberately leaves all runs intact. */
export function applyRunRetention(root: string, retentionDays?: number, now = Date.now()): void {
  if (retentionDays === undefined) return;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 0)
    throw new Error('retentionDays must be non-negative');
  const runs = join(root, '.sloop', 'runs');
  for (const name of readdirSync(runs, { withFileTypes: true })) {
    const stamp = name.name.match(/^(\d{8}T\d{6}Z)/)?.[1];
    const parsed = stamp
      ? Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T').replace(/Z$/, '.000Z'))
      : NaN;
    if (name.isDirectory() && Number.isFinite(parsed) && now - parsed > retentionDays * 86400000)
      rmSync(join(runs, name.name), { recursive: true, force: true });
  }
}
