import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { SessionStore, runHarnessTurn } from '../src/harness.js';
import { context, createMemorySessionIO } from './support/harness-fixtures.mjs';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';

test('writes and reloads sessions through the default filesystem adapter', async () => {
  // Isolate the production adapter's nested atomic write and reload from the repository.
  const temporaryDirectory = createIsolatedTemporaryDirectory(
    join(tmpdir(), 'sloop-session-store-'),
  );
  const sessionFile = join(temporaryDirectory, 'nested', 'sessions.json');
  const sessionKey = { run: 'run-a', issue: 114, role: 'worker' };
  const store = new SessionStore(sessionFile);

  // Act
  await store.set(sessionKey, 'opaque-session');
  const persisted = await readFile(sessionFile, 'utf8');
  const restoredSession = await new SessionStore(sessionFile).get(sessionKey);

  // Assert
  assert.match(persisted, /opaque-session/);
  assert.equal(restoredSession, 'opaque-session');
});

test('resumes the stored session for the same run issue and role', async () => {
  const io = createMemorySessionIO();
  const store = new SessionStore('sessions', io);
  const calls = [];
  const harness = {
    capabilities: { sessions: true },
    async start(_context, turn) {
      calls.push(['start', turn]);
      return { accepted: true, session: 'opaque-a' };
    },
    async resume(_context, turn) {
      calls.push(['resume', turn]);
      return { accepted: true, session: turn.session };
    },
  };

  await runHarnessTurn(
    harness,
    store,
    { run: 'run-a', issue: 114, role: 'worker' },
    context,
    'first',
  );
  await runHarnessTurn(
    harness,
    store,
    { run: 'run-a', issue: 114, role: 'worker' },
    context,
    'second',
  );

  const persisted = JSON.parse(io.content);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['start', 'resume'],
  );
  assert.equal(calls[1][1].prompt, 'second');
  assert.equal(
    persisted[`run-a${String.fromCharCode(0)}114${String.fromCharCode(0)}worker`],
    'opaque-a',
  );
});

test('rejects a session key without a valid run identifier', async () => {
  const store = new SessionStore('sessions', createMemorySessionIO());

  await assert.rejects(
    () => store.get({ run: ' ', issue: 114, role: 'worker' }),
    /session key requires a run, positive issue, and role/,
  );
});

test('reports malformed persisted JSON instead of treating it as missing', async () => {
  const store = new SessionStore('sessions', createMemorySessionIO('{invalid'));

  await assert.rejects(() => store.get({ run: 'run-a', issue: 114, role: 'worker' }), SyntaxError);
});

test('starts a separate session for a different run key', async () => {
  const store = new SessionStore('sessions', createMemorySessionIO());
  const calls = [];
  const harness = {
    capabilities: { sessions: true },
    async start(runContext, turn) {
      calls.push(['start', turn]);
      return { accepted: true, session: `session-${runContext.run}` };
    },
    async resume(_context, turn) {
      calls.push(['resume', turn]);
      return { accepted: true, session: turn.session };
    },
  };

  await runHarnessTurn(
    harness,
    store,
    { run: 'run-a', issue: 114, role: 'worker' },
    context,
    'first',
  );
  await runHarnessTurn(
    harness,
    store,
    { run: 'run-b', issue: 114, role: 'worker' },
    { ...context, run: 'run-b' },
    'other',
  );

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['start', 'start'],
  );
});
