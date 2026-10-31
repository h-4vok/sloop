import type { ActiveRunReconciliation } from '../../core/ActiveRunReconciliation.js';
import type { State } from '../../dispatcher.js';
import type { SloopConfig } from '../../config.js';
import { workspaceAdapter } from '../workspace/index.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;
type ReconcilerOptions = Readonly<{
  client: GitHubCommandClient;
  config: SloopConfig;
  root: string;
}>;
type PullRequestState = Readonly<{
  number?: number;
  state?: string;
  mergedAt?: string;
  baseRefName?: string;
  headRefName?: string;
  body?: string;
}>;
type ActiveRunSnapshot = Readonly<{
  issueState?: string;
  pullRequest?: PullRequestState;
}>;

/** Reconciles one persisted run with GitHub state and its local branch. */
export function reconcileActiveRun(
  options: ReconcilerOptions,
  current: State,
): ActiveRunReconciliation {
  try {
    return reconcileSnapshot(options, current, readSnapshot(options, current));
  } catch (error) {
    return {
      outcome: 'blocked',
      reason: `reconciliation could not verify state: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readSnapshot(options: ReconcilerOptions, current: State): ActiveRunSnapshot {
  const issue = options.client.runJson<{ state?: string }>([
    'issue',
    'view',
    String(current.issue),
    '--json',
    'state',
  ]);
  const pullRequest = readPullRequest(options.client, current.pr);
  return { issueState: issue.state, pullRequest };
}

function readPullRequest(
  client: GitHubCommandClient,
  number?: number,
): PullRequestState | undefined {
  if (!number) return undefined;
  return client.runJson<PullRequestState>([
    'pr',
    'view',
    String(number),
    '--json',
    'number,state,mergedAt,baseRefName,headRefName,body',
  ]);
}

function reconcileSnapshot(
  options: ReconcilerOptions,
  current: State,
  snapshot: ActiveRunSnapshot,
): ActiveRunReconciliation {
  if (!isTerminal(snapshot.issueState, snapshot.pullRequest))
    return { outcome: 'open', reason: 'issue and associated PR are not terminal' };
  const identityFailure = verifyPullRequestIdentity(current, snapshot.pullRequest, options.config);
  if (identityFailure) return { outcome: 'blocked', reason: identityFailure };
  return reconcileBranch(options, current, snapshot.issueState);
}

function reconcileBranch(
  options: ReconcilerOptions,
  current: State,
  issueState: string | undefined,
): ActiveRunReconciliation {
  const branchFacts = workspaceAdapter.reconcileBranch(
    current.branch!,
    options.config.repository.remote,
    options.config.repository.baseBranch,
    options.root,
  );
  if (!branchFacts.aligned)
    return {
      outcome: 'blocked',
      reason: branchFacts.diagnostic,
      localSha: branchFacts.localSha,
      remoteSha: branchFacts.remoteSha,
    };
  return {
    outcome: 'terminal',
    reason:
      issueState?.toUpperCase() === 'CLOSED'
        ? 'issue closed; branch aligned'
        : 'PR merged; branch aligned',
    localSha: branchFacts.localSha,
    remoteSha: branchFacts.remoteSha,
  };
}

function isTerminal(issueState: string | undefined, pullRequest: PullRequestState | undefined) {
  return (
    issueState?.toUpperCase() === 'CLOSED' ||
    pullRequest?.state?.toUpperCase() === 'MERGED' ||
    Boolean(pullRequest?.mergedAt)
  );
}

function verifyPullRequestIdentity(
  current: State,
  pullRequest: PullRequestState | undefined,
  config: SloopConfig,
): string | undefined {
  if (!hasMatchingPullRequestIdentity(current, pullRequest, config))
    return 'issue, PR, and branch identity could not be verified';
  if (!current.branch) return 'persisted worker branch is missing';
  return undefined;
}

function hasMatchingPullRequestIdentity(
  current: State,
  pullRequest: PullRequestState | undefined,
  config: SloopConfig,
): boolean {
  if (!current.pr || !pullRequest) return false;
  return [
    pullRequest.number === current.pr,
    closesIssue(pullRequest, current.issue ?? 0),
    pullRequest.baseRefName === config.repository.baseBranch,
    pullRequest.headRefName === current.branch,
  ].every(Boolean);
}

function closesIssue(pullRequest: PullRequestState, issue: number): boolean {
  const closingReference = new RegExp(
    `(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s+#${issue}\\b`,
    'i',
  );
  return closingReference.test(pullRequest.body ?? '');
}
