import type {
  Config,
  Deps,
  Issue,
  IssueProgress,
  IssueRoundResult,
  PullRequest,
} from '../../types/index.js';
import { ReviewBudget } from '../ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { WorkerExecution } from '../worker/WorkerExecution.js';
const { runWorker } = WorkerExecution;
import { ArbiterWorkflow } from '../ArbiterWorkflow.js';
const { invokeArbiter } = ArbiterWorkflow;
import { ReviewCapPause } from '../ReviewCapPause.js';
const { pauseForReviewCap } = ReviewCapPause;

function isReviewCapExceeded(
  cfg: Config,
  d: Deps,
  round: number,
  arbiterGrantedRound: boolean,
): boolean {
  return !arbiterGrantedRound && round > effectiveMaxRounds(cfg, d.load());
}

async function handleQaFailure(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
  evidence: PullRequest,
  feedback: string,
): Promise<IssueRoundResult> {
  const prNumber = progress.pr;
  if (!prNumber) throw new Error('QA failure requires a PR');
  const qaFeedback = normalizeQaFailureFeedback(feedback);
  d.save({ ...d.load(), lastQaFeedback: qaFeedback, headSha: evidence.headRefOid });
  status(d, issue.number, 'qa_changes_requested', { lastQaFeedback: qaFeedback });

  const steering = await steerQaFailureWithArbiter(
    cfg,
    d,
    issue,
    progress,
    prNumber,
    evidence,
    qaFeedback,
  );
  if (steering.kind === 'terminal') return { finished: true };

  if (isReviewCapExceeded(cfg, d, steering.round, steering.arbiterGrantedRound)) {
    await pauseForReviewCap(cfg, d, issue, steering.round);
    return { finished: true };
  }
  const current = d.load();
  const workerPr = await runWorker(
    cfg,
    d,
    issue,
    steering.round,
    prNumber,
    current.taskContext ?? '',
    steering.feedback,
  );

  return { continueWith: { round: steering.round, pr: workerPr, feedback: steering.feedback } };
}

function normalizeQaFailureFeedback(feedback: string): string {
  return feedback || 'QA requested changes or was blocked.';
}

async function steerQaFailureWithArbiter(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
  pr: number,
  evidence: PullRequest,
  qaFeedback: string,
): Promise<
  | { kind: 'terminal' }
  | { kind: 'continue'; round: number; feedback: string; arbiterGrantedRound: boolean }
> {
  if (!cfg.arbiterCommand)
    return {
      kind: 'continue',

      round: progress.round + 1,

      feedback: qaFeedback,

      arbiterGrantedRound: false,
    };

  const arbiterResult = await invokeIssueArbiter(cfg, d, issue, pr, progress.round, evidence);
  if (arbiterResult === 'terminal') return { kind: 'terminal' };
  if (arbiterResult !== 'continue')
    return {
      kind: 'continue',

      round: progress.round + 1,

      feedback: qaFeedback,

      arbiterGrantedRound: false,
    };

  const round = progress.round + 2;
  d.save({ ...d.load(), reviewRound: round });

  return {
    kind: 'continue',

    round,

    feedback: d.load().lastQaFeedback ?? qaFeedback,

    arbiterGrantedRound: true,
  };
}

async function invokeIssueArbiter(
  cfg: Config,
  d: Deps,
  issue: Issue,
  pr: number,
  round: number,
  evidence: PullRequest,
): Promise<'continue' | 'terminal' | 'not_invoked'> {
  try {
    const result = await invokeArbiter(cfg, d, issue, pr, round, evidence);
    if (result === 'terminal')
      status(d, issue.number, 'human_review_required', {
        lastQaFeedback: d.load().lastQaFeedback,
      });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    d.save({ ...d.load(), lastError: `Arbiter failed: ${message}` });
    throw error;
  }
}

export const IssueQaFailure = { handleQaFailure };
