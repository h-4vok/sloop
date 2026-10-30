import type {
  Config,
  Deps,
  Issue,
  IssueProgress,
  IssueRoundResult,
  PullRequest,
} from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { WorkerExecution } from './WorkerExecution.js';
const { runWorker } = WorkerExecution;
import { ArbiterWorkflow } from './ArbiterWorkflow.js';
const { invokeArbiter } = ArbiterWorkflow;
import { ReviewCapPause } from './ReviewCapPause.js';
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
  const qaFeedback = feedback || 'QA requested changes or was blocked.';
  d.save({ ...d.load(), lastQaFeedback: qaFeedback, headSha: evidence.headRefOid });
  status(d, issue.number, 'qa_changes_requested', { lastQaFeedback: qaFeedback });

  let nextRound = progress.round + 1;
  let nextFeedback = qaFeedback;
  let arbiterGrantedRound = false;
  if (cfg.arbiterCommand) {
    const arbiterResult = await invokeIssueArbiter(
      cfg,
      d,
      issue,
      prNumber,
      progress.round,
      evidence,
    );
    if (arbiterResult === 'terminal') return { finished: true };
    if (arbiterResult === 'continue') {
      nextRound += 1;
      arbiterGrantedRound = true;
      d.save({ ...d.load(), reviewRound: nextRound });
      nextFeedback = d.load().lastQaFeedback ?? qaFeedback;
    }
  }

  if (isReviewCapExceeded(cfg, d, nextRound, arbiterGrantedRound)) {
    await pauseForReviewCap(cfg, d, issue, nextRound);
    return { finished: true };
  }
  const current = d.load();
  const workerPr = await runWorker(
    cfg,
    d,
    issue,
    nextRound,
    prNumber,
    current.taskContext ?? '',
    nextFeedback,
  );

  return { continueWith: { round: nextRound, pr: workerPr, feedback: nextFeedback } };
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
