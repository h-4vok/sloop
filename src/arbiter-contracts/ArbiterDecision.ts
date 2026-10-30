/** Contract for Arbiter rulings tied to a known review finding. */
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
