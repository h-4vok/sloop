import type { HumanFeedbackBatch } from '../session/EngineeringSession.js';

type ReviewObservation = Readonly<{
  id?: string;
  body?: string;
  state?: string;
  submittedAt?: string;
}>;
type CommentObservation = Readonly<{ id?: string; body?: string; createdAt?: string }>;
export type HumanFeedbackInput = Readonly<{
  reviews?: readonly ReviewObservation[];
  comments?: readonly CommentObservation[];
  processedIds?: readonly string[];
}>;

/** Convert GitHub observations into stable feedback IDs and approval signals. */
export function collectHumanFeedback(input: HumanFeedbackInput): HumanFeedbackBatch {
  const processedIds = new Set(input.processedIds ?? []);
  const feedback = { items: [], formalApprovals: [], textualObjections: [] } as {
    items: HumanFeedbackBatch['items'][number][];
    formalApprovals: string[];
    textualObjections: string[];
  };
  (input.reviews ?? []).forEach((review, index) =>
    addReview(feedback, review, index, processedIds),
  );
  (input.comments ?? []).forEach((comment, index) =>
    addComment(feedback, comment, index, processedIds),
  );
  return feedback;
}

function addReview(
  batch: {
    items: HumanFeedbackBatch['items'][number][];
    formalApprovals: string[];
    textualObjections: string[];
  },
  review: ReviewObservation,
  index: number,
  processedIds: ReadonlySet<string>,
) {
  const sourceId = review.id ?? `review-${index}-${review.submittedAt ?? ''}`;
  if (!hasNewFeedback(sourceId, review.body, processedIds)) return;
  const body = review.body.trim();
  recordReviewSignals(batch, sourceId, review.state, body);
  batch.items.push({ sourceId, source: 'review', body, createdAt: review.submittedAt });
}

function addComment(
  batch: { items: HumanFeedbackBatch['items'][number][]; textualObjections: string[] },
  comment: CommentObservation,
  index: number,
  processedIds: ReadonlySet<string>,
) {
  const sourceId = comment.id ?? `comment-${index}-${comment.createdAt ?? ''}`;
  if (!hasNewFeedback(sourceId, comment.body, processedIds)) return;
  const body = comment.body.trim();
  if (isSystemComment(body)) return;
  recordCommentSignals(batch, sourceId, body);
  batch.items.push({ sourceId, source: 'pr_comment', body, createdAt: comment.createdAt });
}

function hasNewFeedback(
  sourceId: string,
  body: string | undefined,
  processedIds: ReadonlySet<string>,
): body is string {
  return !processedIds.has(sourceId) && Boolean(body?.trim());
}

function recordReviewSignals(
  batch: { formalApprovals: string[]; textualObjections: string[] },
  sourceId: string,
  state: string | undefined,
  body: string,
): void {
  if (state === 'APPROVED') batch.formalApprovals.push(sourceId);
  if (hasObjection(body)) batch.textualObjections.push(sourceId);
}

function isSystemComment(body: string): boolean {
  return /^\[(?:Sloop|Worker|QA\/SDET Review|Staff Review)/i.test(body);
}

function recordCommentSignals(
  batch: { textualObjections: string[] },
  sourceId: string,
  body: string,
): void {
  if (hasObjection(body)) batch.textualObjections.push(sourceId);
}

function hasObjection(body: string): boolean {
  return /\b(?:but|however|concern|change|fix|objection|problem|block)/i.test(body);
}
