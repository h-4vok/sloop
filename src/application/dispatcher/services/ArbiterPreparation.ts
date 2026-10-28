import type { Config, Deps, Issue, PullRequest } from '../types/index.js';
import type { ArbiterFinding } from '../../../arbiter-contracts.js';
import type { ArbiterRunContext } from '../types/ArbiterRunContext.js';
import { shouldInvokeArbiter } from '../../../arbiter-contracts.js';
import { RunLogger, runDirectory } from '../../../run-log.js';
import { ReviewBudget } from './ReviewBudget.js';
const { findingIds } = ReviewBudget;
import { AgentRoles } from './AgentRoles.js';
const { roleCommand } = AgentRoles;

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

function prepareArbiter(
  cfg: Config,
  deps: Deps,
  issue: Issue,
  pr: number,
  round: number,
  evidence: PullRequest,
): ArbiterRunContext | undefined {
  if (!cfg.arbiterCommand) throw new Error('arbiterCommand is required');
  const current = deps.load();
  const feedback = current.lastQaFeedback ?? '';
  const closedIds = new Set(
    (current.arbiterDecisions ?? [])
      .filter((decision) => decision.action === 'overrule' || decision.action === 'defer')
      .map((decision) => decision.findingId),
  );
  const findings = createFindings(feedback, closedIds);
  if (!findings.length || !shouldRunArbiter(cfg, round, evidence, findings)) return undefined;

  const logger = new RunLogger(
    runDirectory(deps.root, issue.number, current.workerRunId ?? `arbiter-${round}`),
  );
  deps.setRunLogger?.(logger);
  logger.write('transition', { phase: 'arbiter', round, pr });
  const spec = roleCommand(cfg.arbiterCommand, issue.number, cfg);
  if (!spec) throw new Error('arbiterCommand is required');

  return {
    cfg,
    deps,
    issue,
    pr,
    round,
    evidence,
    current,
    feedback,
    findings,
    logger,
    spec,
    expectedContext: createExpectedContext(current, issue, pr, round, evidence),
  };
}

function shouldRunArbiter(
  cfg: Config,
  round: number,
  evidence: PullRequest,
  findings: readonly ArbiterFinding[],
): boolean {
  return shouldInvokeArbiter({
    substantiveRounds: round,
    findingAppearances: findingAppearances(evidence, findings),
    reviewRounds: cfg.arbiterReviewRounds,
    stagnatingAppearances: cfg.arbiterStagnatingAppearances,
  });
}

/** Prepares validated review context and determines whether Arbiter should run. */
export const ArbiterPreparation = {
  prepareArbiter,
};
