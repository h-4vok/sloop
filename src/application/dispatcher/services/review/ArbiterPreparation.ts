import type { Config, Deps, Issue, PullRequest } from '../../types/index.js';
import type { ArbiterRunContext } from '../../types/ArbiterRunContext.js';
import type { ArbiterFinding } from '../../../../arbiter-contracts.js';
import { shouldInvokeArbiter } from '../../../../arbiter-contracts.js';
import { RunLogger, runDirectory } from '../../../../run-log.js';
import { ArbiterFindingContext } from './ArbiterFindingContext.js';
const { createFindings, findingAppearances, createExpectedContext } = ArbiterFindingContext;
import { AgentRoles } from '../AgentRoles.js';
const { roleCommand } = AgentRoles;

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
  const findings = openArbiterFindings(current, feedback);
  if (!findings.length || !shouldRunArbiter(cfg, round, evidence, findings)) return undefined;

  return createArbiterRunContext(
    cfg,
    deps,
    issue,
    pr,
    round,
    evidence,
    current,
    feedback,
    findings,
  );
}

function openArbiterFindings(
  current: ReturnType<Deps['load']>,
  feedback: string,
): ArbiterFinding[] {
  const closedIds = new Set(
    (current.arbiterDecisions ?? [])
      .filter((decision) => decision.action === 'overrule' || decision.action === 'defer')
      .map((decision) => decision.findingId),
  );

  return createFindings(feedback, closedIds);
}

function createArbiterRunContext(
  cfg: Config,
  deps: Deps,
  issue: Issue,
  pr: number,
  round: number,
  evidence: PullRequest,
  current: ReturnType<Deps['load']>,
  feedback: string,
  findings: ArbiterFinding[],
): ArbiterRunContext {
  const logger = new RunLogger(
    runDirectory(deps.root, issue.number, current.workerRunId ?? `arbiter-${round}`),
  );
  deps.setRunLogger?.(logger);
  logger.write('transition', { phase: 'arbiter', round, pr });
  const spec = roleCommand(cfg.arbiterCommand, issue.number, cfg);
  if (!spec) throw new Error('arbiterCommand is required');

  const expectedContext = createExpectedContext(current, issue, pr, round, evidence);

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

    expectedContext,
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
