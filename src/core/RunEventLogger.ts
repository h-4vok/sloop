/** Structured log and output stream port for one dispatcher run. */
export interface RunEventLogger {
  write(type: string, data?: unknown): void;

  stream(source: 'stdout' | 'stderr' | 'codex', chunk: string): void;
}
