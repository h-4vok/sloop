import {
  classifyFeedback as parseFeedback,
  classifyWithRetry,
} from './feedback/classifyFeedback.js';
export type {
  ArbiterEvent,
  ArbiterRole,
  Classification,
  EngineeringSession,
  HumanFeedback,
  HumanFeedbackBatch,
  ReviewSnapshot,
} from './session/EngineeringSession.js';
export {
  createSession,
  event,
  formatClarificationComment,
  isReviewCurrent,
} from './session/EngineeringSession.js';
export { JsonlJournal } from './session/JsonlJournal.js';
export { restoreSession } from './session/restoreSession.js';
export { collectHumanFeedback } from './feedback/collectHumanFeedback.js';
export type { HumanFeedbackInput } from './feedback/collectHumanFeedback.js';
export { consumeArbiterLine } from './process/consumeArbiterLine.js';
export type { EventConsumer } from './process/consumeArbiterLine.js';
export { runLoggedProcess } from './process/runLoggedProcess.js';
export type { LoggedProcessResult, ProcessSpec } from './process/runLoggedProcess.js';
export type { FeedbackClassifier } from './feedback/classifyFeedback.js';
import type { Classification, HumanFeedback } from './session/EngineeringSession.js';

/** Preserve the historical exception contract at the public facade. */
export function classifyFeedback(items: readonly HumanFeedback[], raw: unknown): Classification[] {
  const parsed = parseFeedback(items, raw);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

export { classifyWithRetry };
