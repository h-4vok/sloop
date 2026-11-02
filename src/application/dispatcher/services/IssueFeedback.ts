import type { Config, Deps, Issue, IssueProgress } from '../types/index.js';
import { HumanReviewGuideService } from './hitl/HumanReviewGuideService.js';
const { latestWorkerComment, humanReviewGuide } = HumanReviewGuideService;

function createIssueProgress(d: Deps): IssueProgress {
  const state = d.load();
  const feedback = [state.lastCiFeedback, state.lastQaFeedback].filter(Boolean).join('\n\n');
  const reviewCapSteer = state.reviewCap?.steer;
  const steerFeedback = reviewCapSteer
    ? `HITL steer (binding): ${reviewCapSteer}. Waived findings at ${state.reviewCap?.decisionSha ?? 'the decision SHA'}: ${(state.reviewCap?.waivedFindingIds ?? []).join(', ') || 'none'}.`
    : '';

  return {
    round: state.reviewRound ?? 1,

    pr: state.pr,

    feedback: [feedback, steerFeedback]
      .filter(Boolean)
      .join(feedback && steerFeedback ? '\n\n' : ''),
  };
}

function shouldRunWorker(d: Deps): boolean {
  const state = d.load();
  return ![
    'worker_ready_for_review',
    'ci_pending',
    'ci_failed',
    'qa_review_pending',
    'qa_approved',
  ].includes(state.status ?? 'queued');
}

async function restoreCompletedWorkerEvidence(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
): Promise<boolean> {
  const state = d.load();
  if (state.status !== 'worker_recovery_pending' || !progress.pr) return false;

  const evidence = await d.pullRequest(progress.pr);
  const worker = latestWorkerComment(evidence, progress.round, evidence.headRefOid);
  const isCurrentReadyWorkerEvidence =
    evidence.state?.toUpperCase() === 'OPEN' &&
    evidence.baseRefName === (cfg.baseBranch ?? 'main') &&
    evidence.headRefName === state.branch &&
    worker?.body?.includes('status=ready_for_review') &&
    humanReviewGuide(worker);
  if (!isCurrentReadyWorkerEvidence) return false;

  d.save({ ...state, status: 'worker_ready_for_review', headSha: evidence.headRefOid });
  return true;
}

export const IssueFeedback = {
  createIssueProgress,

  shouldRunWorker,

  restoreCompletedWorkerEvidence,
};
