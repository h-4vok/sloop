/** Coordinates pull request reader operations for dispatcher workflows. */
import type { DispatcherHost, PullRequest } from '../../../application/dispatcher/types/index.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { GitHubCli } from './GitHubCli.js';
const { ghJson } = GitHubCli;
import { RunStatePolicy } from './state/RunStatePolicy.js';
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
  return {
    number: raw.number,

    state: raw.state,

    baseRefName: raw.baseRefName,

    headRefName: raw.headRefName,

    headRefOid: raw.headRefOid,

    body: raw.body ?? '',

    mergeStateStatus: raw.mergeStateStatus ?? raw.merge_state_status,

    mergeable: raw.mergeable,

    reviews: (raw.reviews ?? []).map((review: any) => ({
      body: review.body,

      state: review.state,

      submittedAt: review.submittedAt ?? review.submitted_at,

      commitId: review.commit?.oid ?? review.commitId ?? review.commit_id,
    })),

    comments: (raw.comments ?? []).map((comment: any) => ({
      body: comment.body,

      createdAt: comment.createdAt ?? comment.created_at,
    })),

    statusCheckRollup: (raw.statusCheckRollup ?? []).map((check: any) => ({
      name: check.name ?? check.context ?? check.workflowName ?? '',

      status: check.status ?? check.state,

      conclusion: check.conclusion ?? check.state,

      detailsUrl: check.detailsUrl ?? check.details_url,
    })),
  };
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
