import type { Issue, PullRequest, Deps } from '../../types/index.js';
import type { ArbiterFinding } from '../../../../arbiter-contracts.js';
import type { ArbiterRunContext } from '../../types/ArbiterRunContext.js';
import { ReviewBudget } from '../ReviewBudget.js';
const { findingIds } = ReviewBudget;

function createFindings(feedback: string, closedIds: ReadonlySet<string>): ArbiterFinding[] {
  return findingIds(feedback)
    .filter((id) => !closedIds.has(id))
    .map((id) => ({
      id,

      owner: id.startsWith('Q') ? 'qa' : 'staff',

      summary: feedback.split(/\r?\n/).find((line) => line.includes(`[${id}]`)) ?? id,
    }));
}

function findingAppearances(evidence: PullRequest, findings: readonly ArbiterFinding[]): number {
  const publishedBodies = [
    ...(evidence.comments ?? []).map((comment) => comment.body ?? ''),
    ...(evidence.reviews ?? []).map((review) => review.body ?? ''),
  ];

  return Math.max(
    0,
    ...findings.map(({ id }) => publishedBodies.filter((body) => body.includes(`[${id}]`)).length),
  );
}

function createExpectedContext(
  current: ReturnType<Deps['load']>,
  issue: Issue,
  pr: number,
  round: number,
  evidence: PullRequest,
) {
  return {
    run: current.workerRunId ?? `arbiter-${round}`,

    issue: issue.number,

    pr,

    round,

    sha: evidence.headRefOid ?? 'unknown',

    cursor: `arbiter-${round}`,
  };
}

export const ArbiterFindingContext = { createFindings, findingAppearances, createExpectedContext };
