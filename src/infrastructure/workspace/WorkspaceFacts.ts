/** Persisted facts identifying an owned execution workspace. */
export type WorkspaceFacts = Readonly<{
  workspaceRoot: string;
  executionRoot: string;
  worktreeRoot?: string;
  branch: string;
  baseSha: string;
  headSha: string;
  ownership: Readonly<{ runId: string; issue: number; protocol: string }>;
}>;
