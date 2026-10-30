import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { createSession } from '../src/arbiter/session/EngineeringSession.ts';
import { JsonlJournal } from '../src/arbiter/session/JsonlJournal.ts';
import { restoreSession } from '../src/arbiter/session/restoreSession.ts';

test('journal appends each event once and restores clarification state', () => {
  // Arrange
  const journalPath = join(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-journal-')),
    'events.jsonl',
  );
  const journal = new JsonlJournal(journalPath);
  const event = {
    id: 'event-1',
    sessionId: 'session-1',
    issue: 41,
    role: 'arbiter',
    round: 1,
    type: 'clarification_requested',
    emittedAt: '2026-10-30T12:00:00Z',
    payload: { question: 'Which behavior is expected?', target: 'form input' },
  };
  const baseSession = createSession(41, 'session-1');

  // Act
  const appended = journal.append(event);
  const duplicateAppend = journal.append(event);
  appendFileSync(journalPath, 'not-json\nnull\n{"id":4}\n');
  const restored = restoreSession(baseSession, journal);

  // Assert
  assert.equal(appended, true);
  assert.equal(duplicateAppend, false);
  assert.deepEqual(
    journal.read().map((item) => item.id),
    ['event-1'],
  );
  assert.equal(restored.status, 'waiting_for_human_clarification');
  assert.equal(restored.pendingClarifications[0].question, 'Which behavior is expected?');
  assert.equal(restored.pendingClarifications[0].target, 'form input');
});
