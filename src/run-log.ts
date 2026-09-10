import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  openSync,
  closeSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
export type RunEvent = Readonly<{ seq: number; at: string; type: string; data?: unknown }>;
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
  private sequence = 0;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.file = join(dir, 'events.jsonl');
    const fd = openSync(this.file, 'a', 0o600);
    closeSync(fd);
    chmodSync(this.file, 0o600);
    const lines = readFileSync(this.file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length) {
      try {
        const previous = JSON.parse(lines.at(-1)!) as { seq?: unknown };
        if (Number.isSafeInteger(previous.seq)) this.sequence = previous.seq as number;
      } catch {
        /* Preserve append-only evidence even when a prior partial line exists. */
      }
    }
  }
  write(type: string, data?: unknown): void {
    const event: RunEvent = {
      seq: ++this.sequence,
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
export function applyRunRetention(root: string, retentionMs?: number, now = Date.now()): void {
  if (retentionMs === undefined) return;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0)
    throw new Error('retentionMs must be non-negative');
  const runs = join(root, '.sloop', 'runs');
  if (!existsSync(runs)) return;
  for (const name of readdirSync(runs, { withFileTypes: true })) {
    const stamp = name.name.match(/^(\d{8}T\d{6}Z)/)?.[1];
    const parsed = stamp
      ? Date.parse(
          stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6.000Z'),
        )
      : NaN;
    if (name.isDirectory() && Number.isFinite(parsed) && now - parsed > retentionMs)
      rmSync(join(runs, name.name), { recursive: true, force: true });
  }
}
