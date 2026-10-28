/** Coordinates review evidence operations for dispatcher workflows. */
import type {
  PullRequest,
  Review,
  Deps,
  Config,
} from '../../../application/dispatcher/types/index.js';
import { HumanReviewGuideService } from './HumanReviewGuideService.js';
const { hasCommit, roundFromBody } = HumanReviewGuideService;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequest } = PullRequestReader;

function latestReview(
  pr: PullRequest,
  marker: '[QA/SDET Review]',
  round: number,
  headSha = pr.headRefOid,
): Review | undefined {
  return [
    ...(pr.reviews ?? []),
    ...(pr.comments ?? []).map((comment): Review => ({
      body: comment.body,

      submittedAt: comment.createdAt,
    })),
  ]
    .filter((review) => {
      const declaredCommit = review.body?.match(/\bcommit=([^\s\\]+)/i)?.[1];
      const commitMatches = review.commitId
        ? review.commitId === headSha && (!declaredCommit || hasCommit(review.body, headSha))
        : Boolean(declaredCommit && hasCommit(review.body, headSha));
      return Boolean(
        headSha &&
        commitMatches &&
        review.body?.trim().startsWith(marker) &&
        roundFromBody(review.body) === round &&
        ['passed', 'approved', 'changes_requested', 'blocked'].includes(
          reviewVerdict(review.body) ?? '',
        ),
      );
    })
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
    .at(-1);
}

function reviewVerdict(body: string | undefined): string | undefined {
  return body?.match(/\bverdict=([a-z_]+)\b/i)?.[1]?.toLowerCase();
}

async function waitForEvidence(
  d: Deps,
  cfg: Config,
  prNumber: number,
  predicate: (pr: PullRequest) => boolean,
): Promise<PullRequest> {
  const deadline = d.now() + (cfg.evidenceTimeoutMs ?? 60000);
  let latest: PullRequest | undefined;
  do {
    latest = await d.pullRequest(prNumber);
    if (predicate(latest)) return latest;
    if (d.now() >= deadline) break;
    await d.sleep(cfg.evidencePollIntervalMs ?? 2000);
  } while (d.now() < deadline);
  return latest!;
}

function reviewFeedback(pr: PullRequest, marker: '[QA/SDET Review]', round: number): string {
  return latestReview(pr, marker, round)?.body ?? '';
}

export const ReviewEvidence = {
  latestReview,

  reviewVerdict,

  waitForEvidence,

  reviewFeedback,
};
