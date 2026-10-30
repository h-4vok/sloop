import { result, type Result } from '../../core/Result.js';
import type { Classification, HumanFeedback } from '../session/EngineeringSession.js';

export type FeedbackClassifier = (items: readonly HumanFeedback[]) => Promise<Classification[]>;

/** Parse classifier output while dropping entries that reference unknown feedback. */
export function classifyFeedback(
  items: readonly HumanFeedback[],
  raw: unknown,
): Result<Classification[], Error> {
  if (!Array.isArray(raw))
    return result.failure(new Error('classifier output must be a JSON array'));
  const knownIds = new Set(items.map((item) => item.sourceId));
  const classifications = raw.flatMap((value) => parseClassification(value, knownIds));
  return result.success(classifications);
}

function parseClassification(value: unknown, knownIds: ReadonlySet<string>): Classification[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const item = value as Record<string, unknown>;
  if (typeof item.sourceId !== 'string' || !knownIds.has(item.sourceId)) return [];
  if (!isIntent(item.intent)) return [];
  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return [];
  return [
    {
      sourceId: item.sourceId,
      intent: item.intent,
      confidence,
      target: typeof item.target === 'string' ? item.target : undefined,
      rationale: typeof item.rationale === 'string' ? item.rationale : undefined,
    },
  ];
}

function isIntent(value: unknown): value is Classification['intent'] {
  return ['approval', 'concern', 'requested_change', 'blocking', 'clarification'].includes(
    String(value),
  );
}

/** Run one bounded classification batch and preserve it if the provider fails. */
export async function classifyWithRetry(
  items: readonly HumanFeedback[],
  classifier: FeedbackClassifier,
  preserve: (items: readonly HumanFeedback[], error: unknown) => void,
): Promise<Classification[]> {
  if (!items.length) return [];
  try {
    return await classifier(items);
  } catch (error) {
    preserve(items, error);
    return [];
  }
}
