import type { ArbiterRunContext } from '../types/ArbiterRunContext.js';
import type { ArbiterDecision } from '../../../arbiter-contracts.js';
import {
  applyArbiterDecisions,
  followUpEligible,
  followUpKey,
} from '../../../arbiter-contracts.js';

function createFollowUps(
  context: ArbiterRunContext,
  decisions: readonly ArbiterDecision[],
): ArbiterRunContext['current'] {
  return decisions.reduce(
    (current, decision) => createFollowUp(context, current, decision),
    context.current,
  );
}

function createFollowUp(
  context: ArbiterRunContext,
  current: ArbiterRunContext['current'],
  decision: ArbiterDecision,
): ArbiterRunContext['current'] {
  if (decision.action !== 'defer') return current;
  const followUp = decision.followUp;
  if (!followUp) return current;

  const createIssue = context.deps.createIssue;
  if (!createIssue) return current;

  const key = followUpKey(context.issue.number, decision.findingId);
  if (current.arbiterFollowUps?.[key]) return current;

  const followUpNumber = createIssue(
    followUp.title,
    `Idempotency key: ${key}\n\nCreated from issue #${context.issue.number}, PR #${context.pr}, finding ${decision.findingId}.\n\nDecision: defer\n\nRationale:\n${decision.rationale}\n\nContext:\n${followUp.context}\n\nAcceptance contract:\n${followUp.acceptance}\n\nThis remains backlog work and is not Automation Ready. It depends on the current PR completing its normal merge/readiness gate.`,
  );

  return {
    ...current,
    ...addFollowUpState(current, key, followUpNumber),
  };
}

function addFollowUpState(
  current: ArbiterRunContext['current'],
  key: string,
  followUpNumber: number,
): Pick<ArbiterRunContext['current'], 'arbiterFollowUps' | 'arbiterFollowUpEligibility'> {
  return {
    arbiterFollowUps: { ...(current.arbiterFollowUps ?? {}), [key]: followUpNumber },
    arbiterFollowUpEligibility: {
      ...(current.arbiterFollowUpEligibility ?? {}),
      [key]: followUpEligible(false, true),
    },
  };
}

function publishDecisions(
  context: ArbiterRunContext,
  proposedDecisions: unknown,
): 'continue' | 'terminal' {
  const result = applyArbiterDecisions(
    {
      interventions: context.current.arbiterInterventions ?? 0,

      decisions: context.current.arbiterDecisions ?? [],
    },
    context.findings,
    proposedDecisions,
    context.cfg.arbiterDecisionLimit,
  );
  const decisions = result.decisions.slice(-context.findings.length);
  const current = createFollowUps(context, decisions);
  const steer = createArbiterSteer(decisions);
  context.deps.save(createDecisionState(current, result, context.feedback, steer));

  const body = createDecisionComment(context, result.interventions, decisions);
  context.deps.comment(context.issue.number, body);
  context.deps.prComment(context.pr, body);

  return result.terminal ? 'terminal' : 'continue';
}

function createArbiterSteer(decisions: readonly ArbiterDecision[]): string {
  return decisions
    .filter((decision) => decision.action === 'uphold')
    .map(
      (decision) =>
        `${decision.findingId}: ${decision.direction}; verify: ${decision.verification}`,
    )
    .join('\n');
}

function createDecisionState(
  current: ArbiterRunContext['current'],
  result: ReturnType<typeof applyArbiterDecisions>,
  feedback: string,
  steer: string,
): ArbiterRunContext['current'] {
  return {
    ...current,

    arbiterInterventions: result.interventions,

    arbiterDecisions: result.decisions,

    arbiterFollowUps: current.arbiterFollowUps,

    arbiterFollowUpEligibility: current.arbiterFollowUpEligibility,

    ...(result.terminal ? { arbiterTerminal: result.terminal } : {}),

    ...(steer
      ? { lastQaFeedback: `${feedback}\n\n[Sloop Arbiter] Worker steering:\n${steer}` }
      : {}),
  };
}

function createDecisionComment(
  context: ArbiterRunContext,
  interventions: number,
  decisions: readonly ArbiterDecision[],
): string {
  return `[Sloop Arbiter] round=${context.round} intervention=${interventions} pr=${context.pr} commit=${context.evidence.headRefOid ?? 'unknown'}\n\n${JSON.stringify(decisions)}`;
}

/** Persists Arbiter decisions and publishes their issue and PR records. */
export const ArbiterDecisionPublisher = {
  publishDecisions,
};
