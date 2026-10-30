export const AGENT_OUTPUT_VERSION = 'sloop.agent-output/v1' as const;

/** Roles permitted to produce a validated Sloop agent envelope. */
export type Role = 'worker' | 'qa' | 'staff' | 'arbiter';

/** Protocol outcomes accepted from agent producers. */
export type RunStatus =
  | 'ready'
  | 'blocked'
  | 'accepted'
  | 'changes-requested'
  | 'uphold'
  | 'overrule'
  | 'defer'
  | 'escalate';
/** Identifies the workflow invocation an agent result belongs to. */
export type RunContext = Readonly<{
  run: string;
  issue: number;
  pr?: number;
  round: number;
  sha: string;
  cursor: string;
}>;
/** Human-readable verification guidance returned in an agent payload. */
export type HumanGuide = Readonly<{
  summary: string;
  steps: string[];
  expected: string[];
  isolation: string;
  limitations: string[];
  checklist: string[];
}>;
/** Versioned result contract shared by agent producers and Sloop. */
export type AgentEnvelope = Readonly<{
  schema: typeof AGENT_OUTPUT_VERSION;
  context: RunContext;
  producer: Role;
  status: RunStatus;
  payload: Record<string, unknown>;
}>;
/** Captured completion result from an agent child process. */
export type ProcessResult = Readonly<{
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}>;
/** Injectable process boundary used by agent runners and tests. */
export type ProcessExecutor = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdin?: string;
    onStdout: (s: string) => void;
    onStderr: (s: string) => void;
  },
) => Promise<ProcessResult>;
