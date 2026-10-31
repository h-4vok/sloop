import type { RunContext } from '../../core/RunContext.js';
import type { WorkspaceAdapter } from '../../core/WorkspaceAdapter.js';
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
    const setExecutionRoot = (path: string) => (executionRoot = path);
    const adapter = createConfiguredWorkspaceAdapter(
      options,
      () => executionRoot,
      setExecutionRoot,
    );

    return { adapter, getExecutionRoot: () => executionRoot };
  },
});

function createConfiguredWorkspaceAdapter(
  options: WorkspaceAdapterOptions,
  getExecutionRoot: () => string,
  setExecutionRoot: (path: string) => string,
): WorkspaceAdapter {
  return {
    mode: options.config.workspace.mode,
    prepare: (issue) => prepareWorkspace(options, issue, setExecutionRoot),
    recover: (issue, runId, branch) =>
      recoverWorkspace(options, issue, runId, branch, setExecutionRoot),
    cleanup: (facts) => cleanupWorkspace(options, facts, setExecutionRoot),
    context: (): RunContext => ({
      originalRepository: options.root,
      executionRoot: getExecutionRoot(),
    }),
  };
}

function prepareWorkspace(
  options: WorkspaceAdapterOptions,
  issue: number,
  setExecutionRoot: (path: string) => string,
) {
  const currentState: State = readState(options.stateFile);
  const workspaceOptions = createWorkspaceOptions(
    options,
    issue,
    currentState.workerRunId ?? 'dispatcher',
  );
  const facts =
    options.config.workspace.mode === 'worktree'
      ? workspaceAdapter.prepareWorktreeWorkspace(workspaceOptions)
      : workspaceAdapter.prepareCheckoutWorkspace(workspaceOptions);
  setExecutionRoot(facts.executionRoot);
  return facts;
}

function recoverWorkspace(
  options: WorkspaceAdapterOptions,
  issue: number,
  runId: string,
  branch: string | undefined,
  setExecutionRoot: (path: string) => string,
) {
  const workspaceOptions = createWorkspaceOptions(options, issue, runId);
  const facts = workspaceAdapter.recoverWorkspace({ ...workspaceOptions, branch });
  setExecutionRoot(facts?.executionRoot ?? options.root);
  return facts;
}

function cleanupWorkspace(
  options: WorkspaceAdapterOptions,
  facts: Parameters<WorkspaceAdapter['cleanup']>[0],
  setExecutionRoot: (path: string) => string,
): void {
  if (options.config.workspace.mode === 'worktree')
    workspaceAdapter.cleanupWorkspace(facts, options.root, options.stateFile);
  setExecutionRoot(options.root);
}

function createWorkspaceOptions(options: WorkspaceAdapterOptions, issue: number, runId: string) {
  return {
    repositoryRoot: options.root,
    remote: options.config.repository.remote,
    baseBranch: options.config.repository.baseBranch,
    branchPrefix: options.config.repository.branchPrefix ?? 'codex/issue-',
    issue,
    runId,
    worktreeRoot: options.config.workspace.worktreeRoot,
    mode: options.config.workspace.mode,
    stateFile: options.stateFile,
  };
}
