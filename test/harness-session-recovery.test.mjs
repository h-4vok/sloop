import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  ResumeAmbiguousError,
  ResumeRejectedError,
  SessionStore,
  runHarnessTurn,
} from '../src/harness.js';
import { context, createMemorySessionIO } from './support/harness-fixtures.mjs';

test('restarts with full context after a pre-turn resume rejection', async () => {
  const io = createMemorySessionIO();
  const key = { run: 'r', issue: 1, role: 'qa' };
  const initial = {
    capabilities: { sessions: true },
    async start() {
      return { accepted: true, session: 'old' };
    },
    async resume() {
      throw new ResumeRejectedError();
    },
  };
  await runHarnessTurn(
    initial,
    new SessionStore('sessions', io),
    key,
    { ...context, ...key },
    'initial',
  );
  const warnings = [];
  const calls = [];
  const recovering = {
    capabilities: { sessions: true },
    async resume() {
      calls.push('resume');
      throw new ResumeRejectedError();
    },
    async start(_context, turn) {
      calls.push(turn.prompt);
      return { accepted: true, session: 'new' };
    },
  };

  await runHarnessTurn(
    recovering,
    new SessionStore('sessions', io),
    key,
    { ...context, ...key },
    'new work',
    (message) => warnings.push(message),
  );

  assert.deepEqual(calls, [
    'resume',
    'issue context\n\nrepo context\n\nprogress\n\nqa updates\n\nnew work',
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(await new SessionStore('sessions', io).get(key), 'new');
});

test('preserves stored sessions when resume outcome is ambiguous', async () => {
  const io = createMemorySessionIO();
  const key = { run: 'r', issue: 1, role: 'qa' };
  await runHarnessTurn(
    {
      capabilities: { sessions: true },
      async start() {
        return { accepted: true, session: 'stored' };
      },
    },
    new SessionStore('sessions', io),
    key,
    { ...context, ...key },
    'initial',
  );
  const ambiguous = {
    capabilities: { sessions: true },
    async resume() {
      throw new ResumeAmbiguousError();
    },
    async start() {
      throw new Error('must not retry');
    },
  };

  await assert.rejects(
    runHarnessTurn(
      ambiguous,
      new SessionStore('sessions', io),
      key,
      { ...context, ...key },
      'ambiguous',
    ),
    ResumeAmbiguousError,
  );
  assert.equal(await new SessionStore('sessions', io).get(key), 'stored');
});
