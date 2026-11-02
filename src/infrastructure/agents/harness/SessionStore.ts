import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionKey } from './HarnessContext.js';

/** Provides the session persistence operations used by SessionStore. */
export interface SessionFileIO {
  read(file: string): Promise<string>;
  write(file: string, content: string): Promise<void>;
}

const fileIO: SessionFileIO = {
  read: (file) => readFile(file, 'utf8'),
  async write(file, content) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, file);
  },
};

function encodeKey(key: SessionKey): string {
  if (!key.run.trim() || !Number.isSafeInteger(key.issue) || key.issue < 1 || !key.role.trim())
    throw new Error('session key requires a run, positive issue, and role');

  return `${encodeURIComponent(key.run)}\0${key.issue}\0${encodeURIComponent(key.role)}`;
}

/** Loads and atomically persists opaque references keyed by run, issue, and role. */
export class SessionStore {
  private readonly entries = new Map<string, string>();
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly io: SessionFileIO = fileIO,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await this.io.read(this.file)) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      for (const [key, value] of Object.entries(raw))
        if (typeof value === 'string' && value) this.entries.set(key, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async get(key: SessionKey): Promise<string | undefined> {
    await this.load();
    return this.entries.get(encodeKey(key));
  }

  async set(key: SessionKey, reference: string): Promise<void> {
    if (!reference.trim()) throw new Error('session reference must be non-empty');
    await this.load();
    this.entries.set(encodeKey(key), reference);
    await this.io.write(this.file, JSON.stringify(Object.fromEntries(this.entries)) + '\n');
  }
}
