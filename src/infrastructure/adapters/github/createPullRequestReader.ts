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
      return {
        number: raw.number,
        state: raw.state,
        baseRefOid: raw.baseRefOid,
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
