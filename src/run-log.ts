import { appendFileSync, chmodSync, mkdirSync, openSync, closeSync } from 'node:fs';
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
}
