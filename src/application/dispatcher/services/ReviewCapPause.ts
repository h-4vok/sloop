import type { Config, Deps, Issue } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds, findingIds } = ReviewBudget;
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { status } = RunStatePolicy;

function createReviewCapSnapshot(cfg: Config, current: ReturnType<Deps['load']>, feedback: string) {
  return {
    capRound: cfg.maxReviewRounds ?? 10,

    decisionSha: current.headSha,

    outstandingFindingIds: findingIds(feedback),

    additionalRounds: current.reviewCap?.additionalRounds ?? 0,

    waivedFindingIds: current.reviewCap?.waivedFindingIds ?? [],

    steer: current.reviewCap?.steer,
  };
}

function createReviewCapNotice(
  cfg: Config,
  current: ReturnType<Deps['load']>,
  round: number,
  outstandingFindingIds: readonly string[],
): string {
  const decisionSha = current.headSha ?? 'unknown';
  const outstanding = outstandingFindingIds.join(',') || 'none';

  return `[HITL Review Cap] round=${round} cap=${effectiveMaxRounds(cfg, current)} sha=${decisionSha} outstanding=${outstanding}. Resolve --resolve-review-cap --steer --additional-rounds --waive --waive-all-outstanding, or --abandon.`;
}

async function pauseForReviewCap(cfg: Config, d: Deps, issue: Issue, round: number): Promise<void> {
  const current = d.load();
  const feedback = current.lastQaFeedback ?? '';
  const cap = createReviewCapSnapshot(cfg, current, feedback);
  status(d, issue.number, 'review_cap_pending', { reviewRound: round, reviewCap: cap });
  const notice = createReviewCapNotice(cfg, current, round, cap.outstandingFindingIds);
  d.comment(issue.number, notice);
  if (current.pr) d.prComment(current.pr, notice);
}

export const ReviewCapPause = { pauseForReviewCap };
