import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { JsonlJournal, consumeArbiterLine, createSession } from '../src/arbiter.js';

const createTemporaryFile = () =>
  join(createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-')), 'events.jsonl');

test('arbiter consumes only valid matching lines', () => {
  const fixture = createArbiterConsumerFixture();

  assert.equal(consumeArbiterLine(fixture.context, 'bad'), false);
  assert.equal(
    consumeArbiterLine(fixture.context, JSON.stringify({ ...fixture.item, issue: 4 })),
    false,
  );
  assert.equal(consumeArbiterLine(fixture.context, JSON.stringify(fixture.item)), true);
  assert.equal(consumeArbiterLine(fixture.context, JSON.stringify(fixture.item)), false);

  const invalidItems = [
    null,
    { id: 'x' },
    { id: 'x', sessionId: 's3', issue: 3, role: 'a', type: 't', payload: null },
  ];
  for (const invalid of invalidItems) {
    const isolatedContext = {
      ...fixture.context,
      journal: new JsonlJournal(createTemporaryFile()),
    };
    assert.equal(consumeArbiterLine(isolatedContext, JSON.stringify(invalid)), false);
  }

  assert.equal(fixture.seen.length, 1);
  assert.equal(fixture.saved().review.sha, 'abc');
});

function createArbiterConsumerFixture() {
  const journal = new JsonlJournal(createTemporaryFile());
  const session = createSession(3, 's3');
  const seen = [];
  let saved;
  const context = {
    session,
    journal,
    save: (value) => {
      saved = value;
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
  return { context, item, seen, saved: () => saved };
}
