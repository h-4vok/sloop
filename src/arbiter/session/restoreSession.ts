import type { Classification, EngineeringSession } from './EngineeringSession.js';
import { JsonlJournal } from './JsonlJournal.js';

/** Rebuild current session state from its durable event journal. */
export function restoreSession(
  base: EngineeringSession,
  journal: JsonlJournal,
): EngineeringSession {
  const restored = createRestoredSession(base);
  for (const item of journal.read()) {
    if (!isNewSessionEvent(item, base, restored)) continue;
    restored.processedEventIds.push(item.id);
    restoreEvent(restored, item);
  }
  restored.updatedAt = new Date().toISOString();
  return restored;
}

function createRestoredSession(base: EngineeringSession): EngineeringSession {
  return {
    ...base,
    agents: { ...base.agents },
    processedEventIds: [...base.processedEventIds],
    pendingClarifications: [...(base.pendingClarifications ?? [])],
    answeredClarificationIds: [...(base.answeredClarificationIds ?? [])],
    classifications: [...(base.classifications ?? [])],
  };
}

function isNewSessionEvent(
  item: ReturnType<JsonlJournal['read']>[number],
  base: EngineeringSession,
  restored: EngineeringSession,
): boolean {
  return item.sessionId === base.sessionId && !restored.processedEventIds.includes(item.id);
}

function restoreEvent(session: EngineeringSession, item: ReturnType<JsonlJournal['read']>[number]) {
  restoreReview(session, item);
  if (item.type === 'clarification_requested') addClarification(session, item);
  if (item.type === 'clarification_answered') answerClarification(session, item);
  if (item.type === 'feedback_classified') restoreClassifications(session, item.payload);
}

function restoreReview(
  session: EngineeringSession,
  item: ReturnType<JsonlJournal['read']>[number],
) {
  if (!item.sha || !['review_started', 'worker_ready'].includes(item.type)) return;
  session.review = { sha: item.sha, round: item.round, capturedAt: item.emittedAt };
}

function addClarification(
  session: EngineeringSession,
  item: ReturnType<JsonlJournal['read']>[number],
) {
  if (session.pendingClarifications.some((value) => value.eventId === item.id)) return;
  session.pendingClarifications.push({
    eventId: item.id,
    sessionId: item.sessionId,
    question: String(item.payload.question ?? 'Please provide clarification.'),
    target: typeof item.payload.target === 'string' ? item.payload.target : undefined,
    instructions:
      typeof item.payload.instructions === 'string' ? item.payload.instructions : undefined,
    createdAt: item.emittedAt,
  });
  session.status = 'waiting_for_human_clarification';
}

function answerClarification(
  session: EngineeringSession,
  item: ReturnType<JsonlJournal['read']>[number],
) {
  const eventId = typeof item.payload.eventId === 'string' ? item.payload.eventId : undefined;
  if (!eventId || session.answeredClarificationIds.includes(eventId)) return;
  session.answeredClarificationIds.push(eventId);
  session.pendingClarifications = session.pendingClarifications.filter(
    (value) => value.eventId !== eventId,
  );
}

function restoreClassifications(session: EngineeringSession, payload: Record<string, unknown>) {
  const values = payload.classifications;
  if (!Array.isArray(values)) return;
  session.classifications = values.filter((value): value is Classification =>
    Boolean(value && typeof value === 'object'),
  );
}
