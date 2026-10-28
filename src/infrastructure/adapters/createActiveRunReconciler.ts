import type { ActiveRunReconciliation } from '../../core/boundaries.js';
import type { State } from '../../dispatcher.js';
import { workspaceAdapter } from '../workspace/index.js';
import type { SloopConfig } from '../../config.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;

type ActiveRunReconcilerOptions = Readonly<{
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

function isTerminal(issueState: string | undefined, pullRequest: PullRequestState | undefined) {
  return (
    issueState?.toUpperCase() === 'CLOSED' ||
    pullRequest?.state?.toUpperCase() === 'MERGED' ||
    Boolean(pullRequest?.mergedAt)
  );
}

function closesIssue(pullRequest: PullRequestState | undefined, issue: number): boolean {
  const closingReference = new RegExp(
    `(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s+#${issue}\\b`,
    'i',
  );

  return closingReference.test(pullRequest?.body ?? '');
}

function verifyPullRequestIdentity(
  current: State,
  pullRequest: PullRequestState | undefined,
  config: SloopConfig,
): string | undefined {
  if (
    !current.pr ||
    !pullRequest ||
    pullRequest.number !== current.pr ||
    !closesIssue(pullRequest, current.issue ?? 0) ||
    pullRequest.baseRefName !== config.repository.baseBranch ||
    pullRequest.headRefName !== current.branch
  )
    return 'issue, PR, and branch identity could not be verified';

  if (!current.branch) return 'persisted worker branch is missing';

  return undefined;
}

/** Creates the production check that reconciles persisted runs with GitHub and Git. */
export const activeRunReconcilerFactory = Object.freeze({
  create(options: ActiveRunReconcilerOptions): (state: State) => ActiveRunReconciliation {
    return (current) => {
      try {
        const issueResponse = options.client.runJson<{ state?: string }>([
          'issue',
          'view',
          String(current.issue),
          '--json',
          'state',
        ]);
        const pullRequest = current.pr
          ? options.client.runJson<PullRequestState>([
              'pr',
              'view',
              String(current.pr),
              '--json',
              'number,state,mergedAt,baseRefName,headRefName,body',
            ])
          : undefined;

        if (!isTerminal(issueResponse.state, pullRequest))
          return { outcome: 'open', reason: 'issue and associated PR are not terminal' };

        const identityFailure = verifyPullRequestIdentity(current, pullRequest, options.config);
        if (identityFailure) return { outcome: 'blocked', reason: identityFailure };

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
            issueResponse.state?.toUpperCase() === 'CLOSED'
              ? 'issue closed; branch aligned'
              : 'PR merged; branch aligned',
          localSha: branchFacts.localSha,
          remoteSha: branchFacts.remoteSha,
        };
      } catch (error) {
        return {
          outcome: 'blocked',
          reason: `reconciliation could not verify state: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };
  },
});
