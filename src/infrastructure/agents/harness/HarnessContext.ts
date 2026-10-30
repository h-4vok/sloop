import type { spawn } from 'node:child_process';

export type HarnessRole = 'worker' | 'qa' | 'staff' | 'arbiter' | (string & {});
export type HarnessCapabilities = Readonly<{ sessions: boolean }>;
export type SessionKey = Readonly<{ run: string; issue: number; role: HarnessRole }>;
export type HarnessContext = Readonly<{
  issue: number;
  role: HarnessRole;
  run: string;
  repository: string;
  issueContext: string;
  progress?: string;
  qaUpdates?: string;
}>;
export type HarnessTurn = Readonly<{ prompt: string; session?: string }>;
export type HarnessResult = Readonly<{ session?: string; accepted: boolean; output?: string }>;

/** Defines the agent boundary used by turn orchestration. */
export interface Harness {
  readonly capabilities: HarnessCapabilities;
  start(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult>;
  resume(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult>;
}

/** Configures the Codex process boundary. */
export type CodexHarnessOptions = Readonly<{
  cwd: string;
  model: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  reasoningEffort: string;
  timeoutMs: number;
  log?: (source: 'stdout' | 'stderr', chunk: string) => void;
  spawn?: typeof spawn;
}>;
