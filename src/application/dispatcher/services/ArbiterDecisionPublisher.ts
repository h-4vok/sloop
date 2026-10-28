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
  let current = context.current;
  for (const decision of decisions) {
    if (decision.action !== 'defer' || !decision.followUp || !context.deps.createIssue) continue;
    const key = followUpKey(context.issue.number, decision.findingId);
    if (current.arbiterFollowUps?.[key]) continue;
    const followUp = decision.followUp;
    const followUpNumber = context.deps.createIssue(
      followUp.title,
      `Idempotency key: ${key}\n\nCreated from issue #${context.issue.number}, PR #${context.pr}, finding ${decision.findingId}.\n\nDecision: defer\n\nRationale:\n${decision.rationale}\n\nContext:\n${followUp.context}\n\nAcceptance contract:\n${followUp.acceptance}\n\nThis remains backlog work and is not Automation Ready. It depends on the current PR completing its normal merge/readiness gate.`,
    );
    current = {
      ...current,

      arbiterFollowUps: { ...(current.arbiterFollowUps ?? {}), [key]: followUpNumber },

      arbiterFollowUpEligibility: {
        ...(current.arbiterFollowUpEligibility ?? {}),

        [key]: followUpEligible(false, true),
      },
    };
  }

  return current;
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
  const steer = decisions
    .filter((decision) => decision.action === 'uphold')
    .map(
      (decision) =>
        `${decision.findingId}: ${decision.direction}; verify: ${decision.verification}`,
    )
    .join('\n');
  context.deps.save({
    ...current,

    arbiterInterventions: result.interventions,

    arbiterDecisions: result.decisions,

    arbiterFollowUps: current.arbiterFollowUps,

    arbiterFollowUpEligibility: current.arbiterFollowUpEligibility,

    ...(result.terminal ? { arbiterTerminal: result.terminal } : {}),

    ...(steer
      ? { lastQaFeedback: `${context.feedback}\n\n[Sloop Arbiter] Worker steering:\n${steer}` }
      : {}),
  });
  const body = `[Sloop Arbiter] round=${context.round} intervention=${result.interventions} pr=${context.pr} commit=${context.evidence.headRefOid ?? 'unknown'}\n\n${JSON.stringify(decisions)}`;
  context.deps.comment(context.issue.number, body);
  context.deps.prComment(context.pr, body);

  return result.terminal ? 'terminal' : 'continue';
}

/** Persists Arbiter decisions and publishes their issue and PR records. */
export const ArbiterDecisionPublisher = {
  publishDecisions,
};
