/** Coordinates pull request reader operations for dispatcher workflows. */
import type { DispatcherHost, PullRequest } from '../../../application/dispatcher/types/index.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { GitHubCli } from './GitHubCli.js';
const { ghJson } = GitHubCli;
import { RunStatePolicy } from './state/RunStatePolicy.js';
import { mapGitHubPullRequest } from './mapGitHubPullRequest.js';
const { status } = RunStatePolicy;

function pullRequest(
  pr: number,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): PullRequest {
  const raw = ghJson<any>(
    [
      'pr',
      'view',
      String(pr),
      '--json',
      'number,state,baseRefName,headRefName,headRefOid,body,mergeStateStatus,mergeable,reviews,comments,statusCheckRollup',
    ],
    cwd,
    repository,
    host,
  );
  return mapGitHubPullRequest.fromResponse(raw);
}

function pullRequestBody(
  pr: number,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): string {
  return (
    ghJson<{ body?: string }>(['pr', 'view', String(pr), '--json', 'body'], cwd, repository, host)
      .body ?? ''
  );
}

export const PullRequestReader = {
  pullRequest,

  pullRequestBody,
};
