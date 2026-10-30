import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One immutable event appended to a run's JSONL evidence file. */
export type RunEvent = Readonly<{ seq: number; at: string; type: string; data?: unknown }>;

/** Persists ordered run events in a private append-only file. */
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
