import { randomUUID } from 'node:crypto';

/** Portable v1 protocol between a configured Arbiter process and Dispatcher. */
export type ArbiterRole = 'arbiter' | 'worker' | 'qa' | 'staff' | 'classifier';
export type ArbiterEvent = Readonly<{
  id: string;
  sessionId: string;
  issue: number;
  role: ArbiterRole;
  round: number;
  sha?: string;
  type: string;
  payload: Record<string, unknown>;
  emittedAt: string;
}>;
export type ReviewSnapshot = Readonly<{ sha: string; round: number; capturedAt: string }>;
export type HumanFeedback = Readonly<{
  sourceId: string;
  source: 'review' | 'inline_comment' | 'pr_comment' | 'issue_comment' | 'reply';
  body: string;
  target?: string;
  createdAt?: string;
}>;
export type Classification = Readonly<{
  sourceId: string;
  intent: 'approval' | 'concern' | 'requested_change' | 'blocking' | 'clarification';
  confidence: number;
  target?: string;
  rationale?: string;
}>;
export type HumanFeedbackBatch = Readonly<{
  items: readonly HumanFeedback[];
  formalApprovals: readonly string[];
  textualObjections: readonly string[];
}>;
export type EngineeringSession = {
  sessionId: string;
  issue: number;
  status:
    | 'running'
    | 'waiting'
    | 'waiting_for_human_clarification'
    | 'worker_recovery_pending'
    | 'in_progress'
    | 'ready_for_human_merge'
    | 'blocked'
    | 'failed';
  round: number;
  review?: ReviewSnapshot;
  agents: Partial<Record<ArbiterRole, { runId: string; status: string; pid?: number }>>;
  processedEventIds: string[];
  unclassifiedFeedback: HumanFeedback[];
  feedback: HumanFeedback[];
  pendingClarifications: Array<{
    eventId: string;
    sessionId: string;
    question: string;
    target?: string;
    instructions?: string;
    createdAt: string;
  }>;
  answeredClarificationIds: string[];
  classifications: Classification[];
  updatedAt: string;
};

/** Create an empty session with the durable fields initialized. */
export function createSession(issue: number, sessionId: string = randomUUID()): EngineeringSession {
  return {
    sessionId,
    issue,
    status: 'running',
    round: 1,
    agents: {},
    processedEventIds: [],
    unclassifiedFeedback: [],
    feedback: [],
    pendingClarifications: [],
    answeredClarificationIds: [],
    classifications: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Add stable event identity and timestamp at the producer boundary. */
export function event(input: Omit<ArbiterEvent, 'id' | 'emittedAt'>): ArbiterEvent {
  return { ...input, id: randomUUID(), emittedAt: new Date().toISOString() };
}

/** Format a human-readable clarification request for the issue or PR thread. */
export function formatClarificationComment(item: ArbiterEvent): string {
  const question = String(item.payload.question ?? 'Please provide clarification.');
  const target = typeof item.payload.target === 'string' ? item.payload.target : undefined;
  const instructions =
    typeof item.payload.instructions === 'string' ? item.payload.instructions : undefined;
  return `[Sloop Arbiter Clarification] session=${item.sessionId} event=${item.id}\n\n${question}${target ? `\n\nTarget: ${target}` : ''}${instructions ? `\n\n${instructions}` : ''}\n\nReply in normal language with the requested clarification.`;
}

/** Check that a persisted review still belongs to the current source and round. */
export function isReviewCurrent(
  snapshot: ReviewSnapshot,
  sha: string,
  round = snapshot.round,
): boolean {
  return snapshot.sha === sha && snapshot.round === round;
}
