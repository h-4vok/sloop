import type { Config, Deps, Issue, IssueProgress, IssueRoundResult } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { CiEvidence } from './CiEvidence.js';
const { waitForCi } = CiEvidence;
import { ReviewExecution } from './review/ReviewExecution.js';
const { runReview } = ReviewExecution;
import { ReviewCapPause } from './ReviewCapPause.js';
const { pauseForReviewCap } = ReviewCapPause;
import { IssueCiFailure } from './IssueCiFailure.js';
const { handleCiFailure } = IssueCiFailure;
import { IssueQaFailure } from './review/IssueQaFailure.js';
const { handleQaFailure } = IssueQaFailure;
import { IssueCompletion } from './IssueCompletion.js';
const { completeIssue } = IssueCompletion;

function ciFailureFeedback(feedback?: string): string {
  return feedback ?? 'Required PR checks failed.';
}

function qaFailureFeedback(body?: string): string {
  return body ?? 'QA requested changes or was blocked.';
}

async function processIssueReviewRound(
  cfg: Config,
  d: Deps,
  issue: Issue,
  progress: IssueProgress,
): Promise<IssueRoundResult> {
  if (progress.round > effectiveMaxRounds(cfg, d.load())) {
    await pauseForReviewCap(cfg, d, issue, progress.round);
    return { finished: true };
  }

  const ci = await waitForCi(d, cfg, issue.number, progress.pr!);
  if (!ci.passed) return handleCiFailure(cfg, d, issue, progress, ciFailureFeedback(ci.feedback));

  const qa = await runReview(cfg, d, issue, 'qa', progress.pr!, progress.round, ci.evidence);
  if (!isApprovedReview(qa.verdict))
    return handleQaFailure(cfg, d, issue, progress, qa.evidence, qaFailureFeedback(qa.body));

  completeIssue(d, issue, progress.round, progress.pr!, qa.evidence, qa.body);
  return { finished: true };
}

function isApprovedReview(verdict: string | undefined): boolean {
  return verdict === 'passed' || verdict === 'approved';
}

export const IssueReviewRound = { processIssueReviewRound };
