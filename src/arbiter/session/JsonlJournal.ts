import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ArbiterEvent } from './EngineeringSession.js';

/** Append-only JSONL storage; malformed records are skipped during crash recovery. */
export class JsonlJournal {
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  append(value: ArbiterEvent): boolean {
    if (this.read().some((item) => item.id === value.id)) return false;
    appendFileSync(this.file, `${JSON.stringify(value)}\n`, 'utf8');
    return true;
  }

  read(): ArbiterEvent[] {
    try {
      return readFileSync(this.file, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => this.parseLine(line));
    } catch {
      return [];
    }
  }

  private parseLine(line: string): ArbiterEvent[] {
    try {
      const value = JSON.parse(line) as ArbiterEvent;
      return value && typeof value.id === 'string' ? [value] : [];
    } catch {
      return [];
    }
  }
}
