import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ResumeAmbiguousError,
  ResumeRejectedError,
  SessionStore,
  runHarnessTurn,
} from '../src/harness.js';

const context = {
  issue: 114,
  role: 'worker',
  run: 'run-a',
  repository: 'repo context',
  issueContext: 'issue context',
  progress: 'progress',
  qaUpdates: 'qa updates',
};

test('starts once, resumes the same run issue role, and isolates other keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-harness-'));
  const store = new SessionStore(join(root, 'sessions.json'));
  const calls = [];
  const harness = {
    capabilities: { sessions: true },
    async start(_, turn) {
      calls.push(['start', turn]);
      return { accepted: true, session: 'opaque-a' };
    },
    async resume(_, turn) {
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
  await runHarnessTurn(
    harness,
    store,
    { run: 'run-b', issue: 114, role: 'worker' },
    { ...context, run: 'run-b' },
    'other',
  );
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['start', 'resume', 'start'],
  );
  assert.equal(calls[1][1].prompt, 'second');
  const persisted = JSON.parse(await readFile(join(root, 'sessions.json'), 'utf8'));
  assert.equal(
    persisted[`run-a${String.fromCharCode(0)}114${String.fromCharCode(0)}worker`],
    'opaque-a',
  );
});

test('persists across store instances and falls back only on pre-turn rejection with full context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-harness-'));
  const file = join(root, 'sessions.json');
  const first = new SessionStore(file);
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
    first,
    { run: 'r', issue: 1, role: 'qa' },
    { ...context, run: 'r', issue: 1, role: 'qa' },
    'initial',
  );
  const warnings = [];
  const second = new SessionStore(file);
  const calls = [];
  const recovering = {
    capabilities: { sessions: true },
    async resume() {
      calls.push('resume');
      throw new ResumeRejectedError();
    },
    async start(_, turn) {
      calls.push(turn.prompt);
      return { accepted: true, session: 'new' };
    },
  };
  await runHarnessTurn(
    recovering,
    second,
    { run: 'r', issue: 1, role: 'qa' },
    { ...context, run: 'r', issue: 1, role: 'qa' },
    'new work',
    (message) => warnings.push(message),
  );
  assert.deepEqual(calls, [
    'resume',
    'issue context\n\nrepo context\n\nprogress\n\nqa updates\n\nnew work',
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(await new SessionStore(file).get({ run: 'r', issue: 1, role: 'qa' }), 'new');
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
    () =>
      runHarnessTurn(
        ambiguous,
        new SessionStore(file),
        { run: 'r', issue: 1, role: 'qa' },
        { ...context, run: 'r', issue: 1, role: 'qa' },
        'ambiguous',
      ),
    ResumeAmbiguousError,
  );
});

test('sessionless harness receives fresh invocations without a persisted reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-harness-'));
  const calls = [];
  const harness = {
    capabilities: { sessions: false },
    async start(_, turn) {
      calls.push(turn);
      return { accepted: true };
    },
    async resume() {
      throw new Error('unsupported');
    },
  };
  const store = new SessionStore(join(root, 'sessions.json'));
  await runHarnessTurn(harness, store, { run: 'r', issue: 1, role: 'worker' }, context, 'one');
  await runHarnessTurn(harness, store, { run: 'r', issue: 1, role: 'worker' }, context, 'two');
  assert.deepEqual(
    calls.map((call) => call.prompt),
    ['one', 'two'],
  );
});
