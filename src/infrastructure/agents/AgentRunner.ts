import { writeFile } from 'node:fs/promises';
import type { AgentEnvelope, ProcessExecutor, RunContext } from './AgentEnvelope.js';

export type RunnerOptions = Readonly<{
  cwd: string;
  timeoutMs?: number;
  retries?: number;
  execute?: ProcessExecutor;
  log?: (source: 'stdout' | 'stderr', chunk: string) => void;
  /** Durable boundary owned by the dispatcher; enables recovery reconciliation. */
  reconciliationDir?: string;
  /** Test seam for the final compare-and-create durable result write. */
  writeReconciliation?: typeof writeFile;
}>;

/** Public execution boundary shared by concrete agent command runners. */
export interface AgentRunner {
  run(input: string, context: RunContext): Promise<AgentEnvelope>;
}
