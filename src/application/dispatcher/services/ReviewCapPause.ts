import type { Config, Deps, Issue } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds, findingIds } = ReviewBudget;
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;

async function pauseForReviewCap(cfg: Config, d: Deps, issue: Issue, round: number): Promise<void> {
  const current = d.load();
  const feedback = current.lastQaFeedback ?? '';
  const cap = {
    capRound: cfg.maxReviewRounds ?? 10,
    decisionSha: current.headSha,
    outstandingFindingIds: findingIds(feedback),
    additionalRounds: current.reviewCap?.additionalRounds ?? 0,
    waivedFindingIds: current.reviewCap?.waivedFindingIds ?? [],
    steer: current.reviewCap?.steer,
  };
  status(d, issue.number, 'review_cap_pending', { reviewRound: round, reviewCap: cap });
  const notice = `[HITL Review Cap] round=${round} cap=${effectiveMaxRounds(cfg, current)} sha=${current.headSha ?? 'unknown'} outstanding=${cap.outstandingFindingIds.join(',') || 'none'}. Resolve --resolve-review-cap --steer --additional-rounds --waive --waive-all-outstanding, or --abandon.`;
  d.comment(issue.number, notice);
  if (current.pr) d.prComment(current.pr, notice);
}

export const ReviewCapPause = { pauseForReviewCap };
