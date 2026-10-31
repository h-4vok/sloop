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
  if (!isClassificationRecord(value)) return [];
  const item = value;
  if (!isKnownFeedback(item.sourceId, knownIds)) return [];
  if (!isIntent(item.intent)) return [];
  const confidence = validConfidence(item.confidence);
  if (confidence === undefined) return [];
  return [createClassification(item, confidence)];
}

function createClassification(item: Record<string, unknown>, confidence: number): Classification {
  return {
    sourceId: item.sourceId as string,
    intent: item.intent as Classification['intent'],
    confidence,
    target: optionalText(item.target),
    rationale: optionalText(item.rationale),
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isClassificationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isKnownFeedback(sourceId: unknown, knownIds: ReadonlySet<string>): sourceId is string {
  return typeof sourceId === 'string' && knownIds.has(sourceId);
}

function validConfidence(value: unknown): number | undefined {
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : undefined;
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
