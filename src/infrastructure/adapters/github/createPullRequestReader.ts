import type { PullRequest } from '../../../dispatcher.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;

/** Reads PR metadata, body, identity, checks, and review conversation from gh. */
export function createPullRequestReader(client: GitHubCommandClient) {
  return {
    read(pullRequestNumber: number): PullRequest {
      const raw = client.runJson<any>([
        'pr',
        'view',
        String(pullRequestNumber),
        '--json',
        'number,state,baseRefName,baseRefOid,headRefName,headRefOid,body,mergeStateStatus,mergeable,reviews,comments,statusCheckRollup',
      ]);
      return normalizePullRequest(raw);
    },

    readBody(pullRequestNumber: number): string {
      return (
        client.runJson<{ body?: string }>([
          'pr',
          'view',
          String(pullRequestNumber),
          '--json',
          'body',
        ]).body ?? ''
      );
    },
  };
}

function normalizePullRequest(raw: any): PullRequest {
  return {
    number: raw.number,
    state: raw.state,
    baseRefOid: raw.baseRefOid,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    body: firstDefined(raw.body, ''),
    mergeStateStatus: firstDefined(raw.mergeStateStatus, raw.merge_state_status),
    mergeable: raw.mergeable,
    reviews: (raw.reviews ?? []).map(normalizeReview),
    comments: (raw.comments ?? []).map(normalizeComment),
    statusCheckRollup: (raw.statusCheckRollup ?? []).map(normalizeStatusCheck),
  };
}

function normalizeReview(review: any) {
  return {
    body: review.body,
    state: review.state,
    submittedAt: firstDefined(review.submittedAt, review.submitted_at),
    commitId: firstDefined(review.commit?.oid, review.commitId, review.commit_id),
  };
}

function normalizeComment(comment: any) {
  return { body: comment.body, createdAt: firstDefined(comment.createdAt, comment.created_at) };
}

function normalizeStatusCheck(check: any) {
  return {
    name: firstDefined(check.name, check.context, check.workflowName, ''),
    status: firstDefined(check.status, check.state),
    conclusion: firstDefined(check.conclusion, check.state),
    detailsUrl: firstDefined(check.detailsUrl, check.details_url),
  };
}

function firstDefined<T>(...values: (T | null | undefined)[]): T | undefined {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}
