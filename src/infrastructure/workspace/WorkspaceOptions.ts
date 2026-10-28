/** Inputs used to prepare, recover, and locate a worker workspace. */
export type WorkspaceOptions = Readonly<{
  mode?: 'checkout' | 'worktree';
  repositoryRoot: string;
  remote: string;
  baseBranch: string;
  branchPrefix: string;
  issue: number;
  runId: string;
  branch?: string;
  worktreeRoot?: string;
  stateFile?: string;
}>;
