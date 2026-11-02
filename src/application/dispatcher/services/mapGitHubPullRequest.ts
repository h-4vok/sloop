import type { PullRequest } from '../../../application/dispatcher/types/index.js';

function mapReviews(reviews: any[] | null = []) {
  return (reviews ?? []).map((review) => ({
    body: review.body,

    state: review.state,

    submittedAt: review.submittedAt ?? review.submitted_at,

    commitId: review.commit?.oid ?? review.commitId ?? review.commit_id,
  }));
}

function mapComments(comments: any[] | null = []) {
  return (comments ?? []).map((comment) => ({
    body: comment.body,

    createdAt: comment.createdAt ?? comment.created_at,
  }));
}

function mapStatusChecks(checks: any[] | null = []) {
  return (checks ?? []).map((check) => ({
    name: statusCheckName(check),

    status: check.status ?? check.state,

    conclusion: check.conclusion ?? check.state,

    detailsUrl: check.detailsUrl ?? check.details_url,
  }));
}

function statusCheckName(check: any): string {
  return check.name ?? check.context ?? check.workflowName ?? '';
}

/** Maps the GitHub CLI pull-request response to the dispatcher contract. */
export const mapGitHubPullRequest = Object.freeze({
  fromResponse(raw: any): PullRequest {
    return {
      number: raw.number,

      state: raw.state,

      baseRefName: raw.baseRefName,

      headRefName: raw.headRefName,

      headRefOid: raw.headRefOid,

      body: raw.body ?? '',

      mergeStateStatus: raw.mergeStateStatus ?? raw.merge_state_status,

      mergeable: raw.mergeable,

      reviews: mapReviews(raw.reviews),

      comments: mapComments(raw.comments),

      statusCheckRollup: mapStatusChecks(raw.statusCheckRollup),
    };
  },
});
