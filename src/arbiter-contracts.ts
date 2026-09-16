export type ArbiterAction = 'uphold' | 'overrule' | 'defer' | 'escalate';
export type ArbiterFinding = Readonly<{ id: string; owner: string; summary: string }>;
export type ArbiterDecision = Readonly<{
  findingId: string;
  owner: string;
  action: ArbiterAction;
  rationale: string;
  direction?: string;
  verification?: string;
  followUp?: Readonly<{ title: string; acceptance: string; context: string }>;
}>;
export type ArbiterState = Readonly<{
  interventions: number;
  decisions: readonly ArbiterDecision[];
  terminal?: 'human_review_required';
}>;

const actions = new Set<ArbiterAction>(['uphold', 'overrule', 'defer', 'escalate']);
const reasonWords = /conflict|argument|analysis|contract|product|ux|justify|rationale/i;

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

export function validateArbiterDecisions(
  findings: readonly ArbiterFinding[],
  decisions: unknown,
  intervention: number,
): ArbiterDecision[] {
  if (!Array.isArray(decisions) || decisions.length !== findings.length)
    throw new Error('arbiter must decide every finding exactly once');
  const known = new Map(findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const result = decisions.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('malformed arbiter decision');
    const value = raw as Record<string, unknown>;
    const finding = known.get(String(value.findingId));
    if (
      !finding ||
      seen.has(finding.id) ||
      typeof value.owner !== 'string' ||
      value.owner !== finding.owner
    )
      throw new Error('decision must preserve finding id and owner');
    const action = value.action as ArbiterAction;
    if (!actions.has(action) || (intervention >= 2 && action === 'uphold'))
      throw new Error('invalid action for intervention');
    if (
      typeof value.rationale !== 'string' ||
      value.rationale.trim().length < 40 ||
      !reasonWords.test(value.rationale)
    )
      throw new Error('insufficient arbiter rationale');
    if (
      action === 'uphold' &&
      (typeof value.direction !== 'string' || typeof value.verification !== 'string')
    )
      throw new Error('uphold requires direction and verification');
    if (action === 'defer' && (!value.followUp || typeof value.followUp !== 'object'))
      throw new Error('defer requires follow-up contract');
    seen.add(finding.id);
    return {
      findingId: finding.id,
      owner: finding.owner,
      action,
      rationale: value.rationale,
      direction: value.direction as string | undefined,
      verification: value.verification as string | undefined,
      followUp: value.followUp as ArbiterDecision['followUp'],
    };
  });
  return result;
}

export function applyArbiterDecisions(
  state: ArbiterState,
  findings: readonly ArbiterFinding[],
  raw: unknown,
): ArbiterState {
  if (state.interventions >= 2) throw new Error('arbiter intervention limit reached');
  const decisions = validateArbiterDecisions(findings, raw, state.interventions + 1);
  return {
    interventions: state.interventions + 1,
    decisions: [...state.decisions, ...decisions],
    terminal: decisions.some((d) => d.action === 'escalate') ? 'human_review_required' : undefined,
  };
}

export function followUpKey(issue: number, findingId: string): string {
  return `sloop/arbiter/follow-up/${issue}/${findingId}`;
}
export function followUpEligible(currentPrMerged: boolean, normalGatePassed: boolean): boolean {
  return currentPrMerged && normalGatePassed;
}
