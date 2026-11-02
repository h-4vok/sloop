/** Coordinates review evidence operations for dispatcher workflows. */
import type { PullRequest, Review, Deps, Config } from '../../types/index.js';
import { HumanReviewGuideService } from '../hitl/HumanReviewGuideService.js';
const { hasCommit, roundFromBody } = HumanReviewGuideService;
import { PullRequestReader } from '../PullRequestReader.js';
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
    .filter((review) => isCurrentReview(review, marker, round, headSha))
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
    .at(-1);
}

function isCurrentReview(
  review: Review,
  marker: '[QA/SDET Review]',
  round: number,
  headSha: string | undefined,
): boolean {
  return (
    hasCurrentReviewCommit(review, headSha) &&
    review.body?.trim().startsWith(marker) === true &&
    roundFromBody(review.body) === round &&
    ['passed', 'approved', 'changes_requested', 'blocked'].includes(
      reviewVerdict(review.body) ?? '',
    )
  );
}

function hasCurrentReviewCommit(review: Review, headSha: string | undefined): boolean {
  if (!headSha) return false;
  const declaredCommit = review.body?.match(/\bcommit=([^\s\\]+)/i)?.[1];
  if (!review.commitId) return hasDeclaredReviewCommit(review.body, headSha, declaredCommit);
  if (review.commitId !== headSha) return false;

  return !declaredCommit || hasCommit(review.body, headSha);
}

function hasDeclaredReviewCommit(
  body: string | undefined,
  headSha: string,
  declaredCommit: string | undefined,
): boolean {
  if (!declaredCommit) return false;

  return hasCommit(body, headSha);
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
  const deadline = d.now() + evidenceTimeout(cfg);
  const pollInterval = evidencePollInterval(cfg);
  while (true) {
    const latest = await d.pullRequest(prNumber);
    if (predicate(latest)) return latest;
    if (d.now() >= deadline) return latest;
    await d.sleep(pollInterval);
    if (d.now() >= deadline) return latest;
  }
}

function evidenceTimeout(cfg: Config): number {
  return cfg.evidenceTimeoutMs ?? 60000;
}

function evidencePollInterval(cfg: Config): number {
  return cfg.evidencePollIntervalMs ?? 2000;
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
