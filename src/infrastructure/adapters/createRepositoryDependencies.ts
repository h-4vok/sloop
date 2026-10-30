import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { RunEventLogger } from '../../core/RunEventLogger.js';
import { RunLogger, runDirectory } from '../../run-log.js';
import type { SloopConfig } from '../../config.js';
import { workspaceAdapter } from '../workspace/index.js';
import type { ProductionAdapterOptions } from './ProductionAdapterOptions.js';
import { dispatcherConfigFactory } from './createDispatcherConfig.js';
import { dispatcherControlsFactory } from './createDispatcherControls.js';
import { dispatcherLockStoreFactory } from './createDispatcherLockStore.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { gitHubProviderFactory } from './createGitHubProvider.js';
import { remoteAuthorityFactory } from './createRemoteAuthority.js';
import { workspaceAdapterFactory } from './createWorkspaceAdapter.js';

/** Builds local repository, GitHub, state, and lock dependencies. */
export function createRepositoryDependencies(
  root: string,
  config: SloopConfig,
  repository: string,
  options: ProductionAdapterOptions,
) {
  const stateFile = join(root, '.sloop', 'state.json');
  const execute = options.execFileSync ?? execFileSync;
  const client = gitHubCommandClientFactory.create(root, repository, execute);
  let runLogger: RunEventLogger | undefined;
  const logGithub = (phase: string, operation: string, data: unknown) =>
    runLogger?.write(`github-${phase}`, { operation, data });
  const workspace = workspaceAdapterFactory.create({ root, stateFile, config });
  const remoteAuthority = remoteAuthorityFactory.create(client, repository, logGithub);
  const githubProvider = gitHubProviderFactory.create({
    root,
    repository,
    eligibleLabel: config.github.labels.eligible,
    priorityLabels: config.github.labels.priority,
    execute,
    logGithub,
  });
  const dispatcherConfig = dispatcherConfigFactory.create(config);
  const controls = dispatcherControlsFactory.create({
    root,
    stateFile,
    repository,
    remoteAuthority,
    config: dispatcherConfig,
    listEligibleIssues: githubProvider.list,
    loadPullRequest: githubProvider.pullRequest,
  });
  const lockStore = dispatcherLockStoreFactory.create(root);

  return {
    config,
    dispatcherConfig,
    controls,
    githubProvider,
    lockStore,
    remoteAuthority,
    setRunLogger: (logger: RunEventLogger | undefined) => {
      runLogger = logger;
    },
    createRunLogger: (issue: number, runId: string) =>
      new RunLogger(runDirectory(root, issue, runId)),
    reportStatus: (message: string) => console.error(message),
    workspace,
    client,
    stateFile,
    root,
    repository,
    listAllWorktrees: () => workspaceAdapter.listWorkspaces(root, stateFile),
    clearAllWorktrees: () => workspaceAdapter.clearWorkspaces(root, stateFile),
  };
}
