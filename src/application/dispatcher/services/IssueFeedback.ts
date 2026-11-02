import type { Config, Deps, Issue, IssueProgress } from '../types/index.js';
import { HumanReviewGuideService } from './hitl/HumanReviewGuideService.js';
const { latestWorkerComment, humanReviewGuide } = HumanReviewGuideService;

function expectedBaseBranch(cfg: Config): string {
  return cfg.baseBranch ?? 'main';
}

function createIssueProgress(d: Deps): IssueProgress {
  const state = d.load();
  const feedback = [state.lastCiFeedback, state.lastQaFeedback].filter(Boolean).join('\n\n');
  const steerFeedback = createReviewCapSteerFeedback(state);

  return {
    round: state.reviewRound ?? 1,

    pr: state.pr,

    feedback: combineIssueFeedback(feedback, steerFeedback),
  };
}

function createReviewCapSteerFeedback(state: ReturnType<Deps['load']>): string {
  const reviewCap = state.reviewCap;
  if (!reviewCap?.steer) return '';

  const decisionSha = reviewCap.decisionSha ?? 'the decision SHA';
  const waivedFindingIds = reviewCap.waivedFindingIds ?? [];

  return `HITL steer (binding): ${reviewCap.steer}. Waived findings at ${decisionSha}: ${waivedFindingIds.join(', ') || 'none'}.`;
}

function combineIssueFeedback(feedback: string, steerFeedback: string): string {
  const separator = feedback && steerFeedback ? '\n\n' : '';

  return [feedback, steerFeedback].filter(Boolean).join(separator);
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

function isCurrentReadyWorkerEvidence(
  cfg: Config,
  state: ReturnType<Deps['load']>,
  evidence: Awaited<ReturnType<Deps['pullRequest']>>,
  worker: ReturnType<typeof latestWorkerComment>,
): boolean {
  return Boolean(
    evidence.state?.toUpperCase() === 'OPEN' &&
    evidence.baseRefName === expectedBaseBranch(cfg) &&
    evidence.headRefName === state.branch &&
    worker?.body?.includes('status=ready_for_review') &&
    humanReviewGuide(worker),
  );
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
  if (!isCurrentReadyWorkerEvidence(cfg, state, evidence, worker)) return false;

  d.save({ ...state, status: 'worker_ready_for_review', headSha: evidence.headRefOid });
  return true;
}

export const IssueFeedback = {
  createIssueProgress,

  shouldRunWorker,

  restoreCompletedWorkerEvidence,
};
