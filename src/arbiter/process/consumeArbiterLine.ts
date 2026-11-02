import type { ArbiterEvent, EngineeringSession } from '../session/EngineeringSession.js';
import { JsonlJournal } from '../session/JsonlJournal.js';
import { restoreSession } from '../session/restoreSession.js';

export type EventConsumer = {
  journal: JsonlJournal;
  session: EngineeringSession;
  save: (session: EngineeringSession) => void;
  project?: (item: ArbiterEvent) => void;
};

/** Persist a valid live event once, restore state, and notify projections. */
export function consumeArbiterLine(context: EventConsumer, line: string): boolean {
  const parsed = parseEvent(line);
  if (!parsed || !matchesSession(parsed, context.session)) return false;
  if (!context.journal.append(parsed)) return false;
  const next = restoreSession(context.session, context.journal);
  context.session = next;
  context.save(next);
  context.project?.(parsed);
  return true;
}

function parseEvent(line: string): ArbiterEvent | undefined {
  try {
    const value = JSON.parse(line) as ArbiterEvent;
    return isEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isEvent(value: ArbiterEvent): boolean {
  return Boolean(value && hasValidIdentity(value) && hasValidPayload(value));
}

function hasValidIdentity(value: ArbiterEvent): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.issue === 'number' &&
    typeof value.role === 'string' &&
    typeof value.type === 'string'
  );
}

function hasValidPayload(value: ArbiterEvent): boolean {
  return Boolean(value.payload && typeof value.payload === 'object');
}

function matchesSession(event: ArbiterEvent, session: EngineeringSession): boolean {
  return event.sessionId === session.sessionId && event.issue === session.issue;
}
