import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SessionStore, runHarnessTurn } from '../src/harness.js';
import { context, createMemorySessionIO } from './support/harness-fixtures.mjs';

test('sessionless harness receives fresh invocations without persisted references', async () => {
  const calls = [];
  const harness = {
    capabilities: { sessions: false },
    async start(_context, turn) {
      calls.push(turn);
      return { accepted: true };
    },
    async resume() {
      throw new Error('unsupported');
    },
  };
  const store = new SessionStore('sessions', createMemorySessionIO());

  await runHarnessTurn(harness, store, { run: 'r', issue: 1, role: 'worker' }, context, 'one');
  await runHarnessTurn(harness, store, { run: 'r', issue: 1, role: 'worker' }, context, 'two');

  assert.deepEqual(
    calls.map((call) => call.prompt),
    ['one', 'two'],
  );
});
