import type { RunContext, WorkspaceAdapter } from '../../core/boundaries.js';
import type { State } from '../../dispatcher.js';
import { readState } from '../../dispatcher.js';
import type { SloopConfig } from '../../config.js';
import { workspaceAdapter } from '../workspace/index.js';

type WorkspaceAdapterOptions = Readonly<{
  root: string;
  stateFile: string;
  config: SloopConfig;
}>;

/** Creates the configured workspace adapter and tracks the active worker directory. */
export const workspaceAdapterFactory = Object.freeze({
  create(options: WorkspaceAdapterOptions): Readonly<{
    adapter: WorkspaceAdapter;
    getExecutionRoot: () => string;
  }> {
    let executionRoot = options.root;
    const workspaceOptions = (issue: number, runId: string) => ({
      repositoryRoot: options.root,
      remote: options.config.repository.remote,
      baseBranch: options.config.repository.baseBranch,
      branchPrefix: options.config.repository.branchPrefix ?? 'codex/issue-',
      issue,
      runId,
      worktreeRoot: options.config.workspace.worktreeRoot,
      mode: options.config.workspace.mode,
      stateFile: options.stateFile,
    });

    const adapter: WorkspaceAdapter = {
      mode: options.config.workspace.mode,
      prepare: (issue) => {
        const currentState: State = readState(options.stateFile);
        const currentOptions = workspaceOptions(issue, currentState.workerRunId ?? 'dispatcher');
        const facts =
          options.config.workspace.mode === 'worktree'
            ? workspaceAdapter.prepareWorktreeWorkspace(currentOptions)
            : workspaceAdapter.prepareCheckoutWorkspace(currentOptions);
        executionRoot = facts.executionRoot;

        return facts;
      },
      recover: (issue, runId, branch) => {
        const facts = workspaceAdapter.recoverWorkspace({
          ...workspaceOptions(issue, runId),
          branch,
        });
        executionRoot = facts?.executionRoot ?? options.root;

        return facts;
      },
      cleanup: (facts) => {
        if (options.config.workspace.mode === 'worktree')
          workspaceAdapter.cleanupWorkspace(facts, options.root, options.stateFile);
        executionRoot = options.root;
      },
      context: (): RunContext => ({ originalRepository: options.root, executionRoot }),
    };

    return { adapter, getExecutionRoot: () => executionRoot };
  },
});
