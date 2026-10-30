import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import {
  JsonlJournal,
  classifyWithRetry,
  consumeArbiterLine,
  createSession,
} from '../src/arbiter.js';
const createTemporaryFile = () =>
  join(createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-')), 'events.jsonl');

test('arbiter consumes only valid matching lines and classifies with retry preservation', async () => {
  const file = createTemporaryFile();
  const journal = new JsonlJournal(file);
  const session = createSession(3, 's3');
  const seen = [];
  const context = {
    session,

    journal,

    save: (value) => {
      context.saved = value;
    },

    project: (value) => seen.push(value),
  };
  const item = {
    id: 'x',

    sessionId: 's3',

    issue: 3,

    role: 'arbiter',

    type: 'worker_ready',

    sha: 'abc',

    round: 1,

    emittedAt: new Date().toISOString(),

    payload: {},
  };

  assert.equal(consumeArbiterLine(context, 'bad'), false);
  assert.equal(consumeArbiterLine(context, JSON.stringify({ ...item, issue: 4 })), false);
  assert.equal(consumeArbiterLine(context, JSON.stringify(item)), true);
  assert.equal(consumeArbiterLine(context, JSON.stringify(item)), false);
  for (const invalid of [
    null,
    { id: 'x' },
    { id: 'x', sessionId: 's3', issue: 3, role: 'a', type: 't', payload: null },
  ])
    assert.equal(
      consumeArbiterLine(
        { ...context, journal: new JsonlJournal(createTemporaryFile()) },
        JSON.stringify(invalid),
      ),
      false,
    );
  assert.equal(seen.length, 1);
  assert.equal(context.saved.review.sha, 'abc');
  const preserved = [];
  assert.deepEqual(
    await classifyWithRetry(
      [],
      async () => [],
      () => {},
    ),
    [],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => ['ok'],
      () => {},
    ),
    ['ok'],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => {
        throw new Error('no');
      },
      (items, error) => preserved.push([items, error.message]),
    ),
    [],
  );
  assert.equal(preserved[0][1], 'no');
});
