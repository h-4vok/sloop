import type { RunContext } from './RunContext.js';
import type { WorkspaceFacts } from './WorkspaceFacts.js';

/** Prepares and cleans isolated execution workspaces for dispatcher runs. */
export interface WorkspaceAdapter {
  prepare(issue: number): WorkspaceFacts;

  recover(issue: number, runId: string, branch?: string): WorkspaceFacts | undefined;

  cleanup(facts: WorkspaceFacts): void;

  context?(): RunContext;

  readonly mode?: 'checkout' | 'worktree';
}
