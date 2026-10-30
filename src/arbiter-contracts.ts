import { validateArbiterDecisions as validateResult } from './arbiter-contracts/validateArbiterDecisions.js';
export type {
  ArbiterAction,
  ArbiterDecision,
  ArbiterFinding,
  ArbiterState,
} from './arbiter-contracts/ArbiterDecision.js';
import type {
  ArbiterDecision,
  ArbiterFinding,
  ArbiterState,
} from './arbiter-contracts/ArbiterDecision.js';
export { validateArbiterDecisions as validateArbiterDecisionsResult } from './arbiter-contracts/validateArbiterDecisions.js';

/** Keep validation failures translated at the existing public boundary. */
export function validateArbiterDecisions(
  findings: readonly ArbiterFinding[],
  decisions: unknown,
  intervention: number,
): ArbiterDecision[] {
  const validated = validateResult(findings, decisions, intervention);
  if (!validated.ok) throw validated.error;
  return validated.value;
}

export function shouldInvokeArbiter(input: {
  substantiveRounds: number;
  findingAppearances: number;
  reviewRounds?: number;
  stagnatingAppearances?: number;
}): boolean {
  return (
    input.substantiveRounds >= (input.reviewRounds ?? 3) ||
    input.findingAppearances >= (input.stagnatingAppearances ?? 2)
  );
}

export function applyArbiterDecisions(
  state: ArbiterState,
  findings: readonly ArbiterFinding[],
  raw: unknown,
  maxInterventions = 2,
): ArbiterState {
  if (state.interventions >= maxInterventions)
    throw new Error('arbiter intervention limit reached');
  const decisions = validateArbiterDecisions(findings, raw, state.interventions + 1);
  return {
    interventions: state.interventions + 1,
    decisions: [...state.decisions, ...decisions],
    terminal: decisions.some((decision) => decision.action === 'escalate')
      ? 'human_review_required'
      : undefined,
  };
}

export function followUpKey(issue: number, findingId: string): string {
  return `sloop/arbiter/follow-up/${issue}/${findingId}`;
}

export function followUpEligible(currentPrMerged: boolean, normalGatePassed: boolean): boolean {
  return currentPrMerged && normalGatePassed;
}
