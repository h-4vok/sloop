import type { Config, Deps, Issue, IssueProgress, IssueRoundResult } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { effectiveMaxRounds } = ReviewBudget;
import { CiEvidence } from './CiEvidence.js';
const { waitForCi } = CiEvidence;
import { ReviewExecution } from './ReviewExecution.js';
const { runReview } = ReviewExecution;
import { ReviewCapPause } from './ReviewCapPause.js';
const { pauseForReviewCap } = ReviewCapPause;
import { IssueCiFailure } from './IssueCiFailure.js';
const { handleCiFailure } = IssueCiFailure;
import { IssueQaFailure } from './IssueQaFailure.js';
const { handleQaFailure } = IssueQaFailure;
import { IssueCompletion } from './IssueCompletion.js';
const { completeIssue } = IssueCompletion;

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
  if (!ci.passed)
    return handleCiFailure(cfg, d, issue, progress, ci.feedback ?? 'Required PR checks failed.');

  const qa = await runReview(cfg, d, issue, 'qa', progress.pr!, progress.round, ci.evidence);
  if (qa.verdict !== 'passed' && qa.verdict !== 'approved')
    return handleQaFailure(
      cfg,
      d,
      issue,
      progress,
      qa.evidence,
      qa.body ?? 'QA requested changes or was blocked.',
    );

  completeIssue(d, issue, progress.round, progress.pr!, qa.evidence, qa.body);
  return { finished: true };
}

export const IssueReviewRound = { processIssueReviewRound };
