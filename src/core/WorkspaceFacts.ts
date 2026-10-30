/** Paths and ownership data identifying one execution workspace. */
export type WorkspaceFacts = Readonly<{
  workspaceRoot: string;
  executionRoot: string;
  worktreeRoot?: string;
  branch: string;
  baseSha: string;
  headSha: string;
  ownership: Readonly<{ runId: string; issue: number; protocol: string }>;
}>;
