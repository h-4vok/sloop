import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import {
  JsonlJournal,
  createSession,
  formatClarificationComment,
  isReviewCurrent,
  restoreSession,
} from '../src/arbiter.js';

const createTemporaryFile = () =>
  join(createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-')), 'events.jsonl');

function createJournalEvent(id, sessionId, type, payload = {}, extra = {}) {
  return {
    id,
    sessionId,
    issue: 1,
    role: 'arbiter',
    round: 2,
    type,
    emittedAt: '2020-01-01T00:00:00Z',
    payload,
    ...extra,
  };
}

test('journal persists unique events and restores review and clarification state', () => {
  // Arrange
  const journal = new JsonlJournal(createTemporaryFile());
  const session = createSession(1, 'session-1');
  const reviewEvent = createJournalEvent(
    'review',
    'session-1',
    'review_started',
    {},
    { sha: 'abc' },
  );
  const clarificationEvent = createJournalEvent(
    'question',
    'session-1',
    'clarification_requested',
    {
      question: 'Which behavior is expected?',
      target: 'form input',
    },
  );

  // Act
  const firstAppend = journal.append(reviewEvent);
  const duplicateAppend = journal.append(reviewEvent);
  journal.append(clarificationEvent);
  const restored = restoreSession(session, journal);
  const comment = formatClarificationComment(clarificationEvent);

  // Assert
  assert.equal(firstAppend, true);
  assert.equal(duplicateAppend, false);
  assert.deepEqual(
    journal.read().map((item) => item.id),
    ['review', 'question'],
  );
  assert.equal(restored.review.sha, 'abc');
  assert.equal(restored.pendingClarifications[0].question, 'Which behavior is expected?');
  assert.equal(restored.status, 'waiting_for_human_clarification');
  assert.match(comment, /Target: form input/);
  assert.equal(isReviewCurrent(restored.review, 'abc', 2), true);
  assert.equal(isReviewCurrent(restored.review, 'def'), false);
});

test('journal replay ignores malformed and foreign events and applies answers and classifications', () => {
  // Arrange
  const journalFile = createTemporaryFile();
  const journal = new JsonlJournal(journalFile);
  const session = createSession(1, 'session-1');
  journal.append(createJournalEvent('foreign', 'other-session', 'clarification_requested'));
  journal.append(
    createJournalEvent('question', 'session-1', 'clarification_requested', { question: 'Q' }),
  );
  journal.append(
    createJournalEvent('answer', 'session-1', 'clarification_answered', { eventId: 'question' }),
  );
  journal.append(
    createJournalEvent('feedback', 'session-1', 'feedback_classified', {
      classifications: [null, { sourceId: 'review-1' }],
    }),
  );
  appendFileSync(journalFile, 'not-json\nnull\n{"id":4}\n');

  // Act
  const restored = restoreSession(session, journal);

  // Assert
  assert.deepEqual(restored.processedEventIds, ['question', 'answer', 'feedback']);
  assert.deepEqual(restored.answeredClarificationIds, ['question']);
  assert.deepEqual(restored.pendingClarifications, []);
  assert.deepEqual(restored.classifications, [{ sourceId: 'review-1' }]);
  assert.deepEqual(
    journal.read().map((item) => item.id),
    ['foreign', 'question', 'answer', 'feedback'],
  );
});

test('journal replay preserves existing clarification while adding a new request', () => {
  // Arrange
  const journal = new JsonlJournal(createTemporaryFile());
  const session = createSession(1, 'session-1');
  session.pendingClarifications.push({
    eventId: 'existing-question',

    sessionId: 'session-1',

    question: 'Existing question?',

    createdAt: '2020-01-01T00:00:00Z',
  });
  journal.append(
    createJournalEvent('new-question', 'session-1', 'clarification_requested', {
      question: 'New question?',
    }),
  );

  // Act
  const restored = restoreSession(session, journal);

  // Assert
  assert.deepEqual(
    restored.pendingClarifications.map((clarification) => clarification.eventId),
    ['existing-question', 'new-question'],
  );
});
