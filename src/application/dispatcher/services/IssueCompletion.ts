import type { Deps, Issue, PullRequest } from '../types/index.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;
import { HumanReviewGuideService } from './HumanReviewGuideService.js';
const { publishHumanReviewGuide } = HumanReviewGuideService;

function completeIssue(
  d: Deps,
  issue: Issue,
  round: number,
  pr: number,
  evidence: PullRequest,
  qaFeedback: string | undefined,
): void {
  status(d, issue.number, 'qa_approved', {
    headSha: evidence.headRefOid,

    lastQaFeedback: qaFeedback,

    lastError: undefined,

    lastErrorVerbose: undefined,
  });
  publishHumanReviewGuide(d, evidence, round);
  status(d, issue.number, 'ready_for_human_merge', { pr, headSha: evidence.headRefOid });
  const state = d.load();
  d.save({
    ...state,

    completedIssues: [...new Set([...(state.completedIssues ?? []), issue.number])],

    workerPid: undefined,

    drainStatus: 'running',
  });
  d.comment(
    issue.number,
    '[Worker] sloop gates passed; ready_for_human_merge, no merge performed.',
  );
}

export const IssueCompletion = { completeIssue };
