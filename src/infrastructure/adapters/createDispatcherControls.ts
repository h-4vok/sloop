import type { CliControl } from '../../core/CliControl.js';
import type { RemoteAuthority } from '../../core/RemoteAuthority.js';
import type { Workspace } from '../../core/Workspace.js';
import {
  linkIssueToActiveRun,
  prepareRecovery,
  readState,
  recoverStaleLock,
  resetRunState,
  resolveReviewCap,
  writeState,
} from '../../dispatcher.js';
import type { Config, PullRequest, State } from '../../dispatcher.js';
import { defaultProcessAlive } from '../../dispatcher.js';

type DispatcherControlOptions = Readonly<{
  root: string;
  stateFile: string;
  repository: string;
  remoteAuthority: RemoteAuthority;
  config: Config;
  listEligibleIssues: () => readonly { number: number; title: string }[];
  loadPullRequest: (pullRequest: number) => PullRequest;
}>;

type DispatcherControls = CliControl<Config> & Workspace<State>;

function mapRecoveryPullRequest(pullRequest: PullRequest) {
  return {
    baseRefOid: pullRequest.baseRefOid,

    headRefName: pullRequest.headRefName,

    headRefOid: pullRequest.headRefOid,
  };
}

function prepareIssueRecovery(
  options: DispatcherControlOptions,
  issue: number,
  requestedPullRequest: number | undefined,
  config: Config,
): number {
  const state: State = readState(options.stateFile);
  const pullRequestNumber = requestedPullRequest ?? state.pr;
  if (!Number.isInteger(issue) || issue < 1)
    throw new Error('--prepare-recovery requires an issue number');
  if (!pullRequestNumber || !Number.isInteger(pullRequestNumber))
    throw new Error('--prepare-recovery requires --pr or an existing state.pr');

  const pullRequest = options.loadPullRequest(pullRequestNumber);
  const recoveryState = prepareRecovery(
    state,
    issue,
    pullRequestNumber,
    Date.now(),
    config.workerLeaseMs ?? 900000,
    mapRecoveryPullRequest(pullRequest),
  );
  writeState(recoveryState, options.stateFile);

  return pullRequestNumber;
}

/** Creates dispatcher-control ports backed by the local state file and GitHub adapter. */
export const dispatcherControlsFactory = Object.freeze({
  create(options: DispatcherControlOptions): DispatcherControls {
    return {
      root: options.root,

      load: () => readState(options.stateFile),

      save: (state) => writeState(state, options.stateFile),

      loadConfig: () => options.config,

      status: (verbose) => {
        const currentState = readState(options.stateFile);

        return verbose
          ? currentState
          : {
              issue: currentState.issue,

              pr: currentState.pr,

              status: currentState.status,

              lastError: currentState.lastError,
            };
      },

      list: () => options.listEligibleIssues(),

      recoverLock: () => recoverStaleLock(options.root, defaultProcessAlive),

      reset: () =>
        writeState(
          resetRunState(readState(options.stateFile), defaultProcessAlive),
          options.stateFile,
        ),

      resolveReviewCap: (args, config) =>
        resolveReviewCap(
          args,
          config,
          options.stateFile,
          options.root,
          options.repository,
          {},
          options.remoteAuthority,
        ),

      linkIssue: (issue) =>
        linkIssueToActiveRun(issue, options.stateFile, options.root, options.repository),

      prepareRecovery: (issue, pullRequest, config) =>
        prepareIssueRecovery(options, issue, pullRequest, config),
    };
  },
});
