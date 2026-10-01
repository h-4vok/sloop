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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('malformed arbiter decision');
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'findingId',
            'owner',
            'action',
            'rationale',
            'direction',
            'verification',
            'followUp',
          ].includes(key),
      )
    )
      throw new Error('unknown arbiter decision field');
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
    if (typeof value.rationale !== 'string' || !value.rationale.trim())
      throw new Error('insufficient arbiter rationale');
    for (const field of ['direction', 'verification'])
      if (value[field] != null && typeof value[field] !== 'string')
        throw new Error(`invalid arbiter ${field}`);
    if (
      action === 'uphold' &&
      (typeof value.direction !== 'string' ||
        !value.direction.trim() ||
        typeof value.verification !== 'string' ||
        !value.verification.trim())
    )
      throw new Error('uphold requires direction and verification');
    if (action === 'defer' && !value.followUp) throw new Error('defer requires follow-up contract');
    if (value.followUp != null) {
      if (typeof value.followUp !== 'object' || Array.isArray(value.followUp))
        throw new Error('invalid follow-up contract');
      const followUp = value.followUp as Record<string, unknown>;
      if (
        Object.keys(followUp).some((key) => !['title', 'acceptance', 'context'].includes(key)) ||
        ['title', 'acceptance', 'context'].some(
          (key) => typeof followUp[key] !== 'string' || !(followUp[key] as string).trim(),
        )
      )
        throw new Error('invalid follow-up contract');
    }
    seen.add(finding.id);
    return {
      findingId: finding.id,
      owner: finding.owner,
      action,
      rationale: value.rationale,
      direction: (value.direction ?? undefined) as string | undefined,
      verification: (value.verification ?? undefined) as string | undefined,
      followUp: (value.followUp ?? undefined) as ArbiterDecision['followUp'],
    };
  });
  return result;
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
    terminal: decisions.some((d) => d.action === 'escalate') ? 'human_review_required' : undefined,
  };
}

export function followUpKey(issue: number, findingId: string): string {
  return `sloop/arbiter/follow-up/${issue}/${findingId}`;
}
export function followUpEligible(currentPrMerged: boolean, normalGatePassed: boolean): boolean {
  return currentPrMerged && normalGatePassed;
}
