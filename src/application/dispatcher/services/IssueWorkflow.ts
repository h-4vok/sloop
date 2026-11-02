import type { Config, Deps, Issue, IssueProgress, IssueRoundResult } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { WorkerExecution } from './worker/WorkerExecution.js';
const { runWorker } = WorkerExecution;
import { IssueFeedback } from './IssueFeedback.js';
const { createIssueProgress, shouldRunWorker, restoreCompletedWorkerEvidence } = IssueFeedback;
import { ReviewCapPause } from './ReviewCapPause.js';
const { pauseForReviewCap } = ReviewCapPause;
import { IssueReviewRound } from './IssueReviewRound.js';
const { processIssueReviewRound } = IssueReviewRound;

async function runInitialWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
): Promise<IssueProgress> {
  const restored = await restoreCompletedWorkerEvidence(cfg, d, issue, progress);
  const current = d.load();
  const shouldRunWorker = shouldResumeWorker(restored, current.status, d);
  if (!shouldRunWorker) return { ...progress, pr: current.pr };

  const pr = await runWorker(
    cfg,
    d,
    issue,
    progress.round,
    progress.pr,
    current.taskContext ?? '',
    progress.feedback,
  );

  return { ...progress, pr };
}

function shouldRunWorkerFromState(d: Deps): boolean {
  return shouldRunWorker(d);
}

function shouldResumeWorker(restored: boolean, status: string | undefined, d: Deps): boolean {
  return (!restored && shouldRunWorkerFromState(d)) || hasFailedReview(status);
}

function hasFailedReview(status: string | undefined): boolean {
  return status === 'ci_failed' || status === 'qa_changes_requested';
}

async function processIssue(cfg: Config, d: Deps, issue: Issue): Promise<void> {
  let progress = createIssueProgress(d);
  if (progress.round > effectiveMaxRounds(cfg, d.load())) {
    await pauseForReviewCap(cfg, d, issue, progress.round);
    return;
  }
  progress = await runInitialWorker(cfg, d, issue, progress);
  if (!progress.pr) throw new Error('dispatcher requires a PR before CI and reviews');

  while (true) {
    const result: IssueRoundResult = await processIssueReviewRound(cfg, d, issue, progress);
    if ('finished' in result) return;
    progress = result.continueWith;
  }
}

export const IssueWorkflow = { processIssue };
