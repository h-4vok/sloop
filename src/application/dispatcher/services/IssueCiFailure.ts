import type { Config, Deps, Issue, IssueProgress, IssueRoundResult } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { ReviewCapPause } from './ReviewCapPause.js';
const { pauseForReviewCap } = ReviewCapPause;
import { WorkerExecution } from './WorkerExecution.js';
const { runWorker } = WorkerExecution;

async function handleCiFailure(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
  feedback: string,
): Promise<IssueRoundResult> {
  const nextFeedback = feedback || 'Required PR checks failed.';
  d.save({ ...d.load(), lastCiFeedback: nextFeedback, reviewRound: progress.round });
  const nextRound = progress.round + 1;
  if (nextRound > effectiveMaxRounds(cfg, d.load())) {
    await pauseForReviewCap(cfg, d, issue, nextRound);
    return { finished: true };
  }

  const current = d.load();
  const pr = await runWorker(
    cfg,
    d,
    issue,
    nextRound,
    progress.pr,
    current.taskContext ?? '',
    nextFeedback,
  );

  return { continueWith: { round: nextRound, pr, feedback: nextFeedback } };
}

export const IssueCiFailure = { handleCiFailure };
