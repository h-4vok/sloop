import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ResumeAmbiguousError,
  CodexHarness,
  ResumeRejectedError,
  SessionStore,
  runHarnessTurn,
} from '../src/harness.js';

function codexProcess({ stdout = [], stderr = [], code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    for (const chunk of stdout) child.stdout.emit('data', chunk);
    for (const chunk of stderr) child.stderr.emit('data', chunk);
    child.emit('close', code);
  });
  return child;
}

function codexHarness(response, calls, logs = []) {
  return new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    log: (source, chunk) => logs.push([source, chunk]),
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return codexProcess(response);
    },
  });
}

const context = {
  issue: 114,
  role: 'worker',
  run: 'run-a',
  repository: 'repo context',
  issueContext: 'issue context',
  progress: 'progress',
  qaUpdates: 'qa updates',
};

test('CodexHarness starts with typed CLI options, extracts the session, and logs raw output', async () => {
  const calls = [];
  const logs = [];
  const harness = codexHarness(
    {
      stdout: ['{"type":"thread.started","thread_id":"session-start"}\n', '{"type":"message"}\n'],
      stderr: ['diagnostic\n'],
    },
    calls,
    logs,
  );

  const result = await harness.start(context, { prompt: 'do the work' });

  assert.deepEqual(result, { accepted: true, session: 'session-start' });
  assert.equal(calls[0].file, 'codex');
  assert.deepEqual(calls[0].args, [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '--model',
    'gpt-5-codex',
    '--config',
    'model_reasoning_effort=high',
    'do the work',
  ]);
  assert.deepEqual(logs, [
    ['stdout', '{"type":"thread.started","thread_id":"session-start"}\n'],
    ['stdout', '{"type":"message"}\n'],
    ['stderr', 'diagnostic\n'],
  ]);
  assert.equal(calls[0].options.cwd, 'fixture-repository');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('CodexHarness returns completed agent messages as the turn output', async () => {
  const calls = [];
  const harness = codexHarness(
    {
      stdout: [
        '{"type":"thread.started","thread_id":"session-start"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"WORKER_RESULT pr=35 base=main"}}\n',
      ],
    },
    calls,
  );

  const result = await harness.start(context, { prompt: 'finish the work' });

  assert.deepEqual(result, {
    accepted: true,
    session: 'session-start',
    output: 'WORKER_RESULT pr=35 base=main',
  });
});

test('CodexHarness resumes the supplied opaque session and accepts a replacement', async () => {
  const calls = [];
  const harness = codexHarness(
    { stdout: ['{"type":"thread.started","thread_id":"session-next"}\n'] },
    calls,
  );

  const result = await harness.resume(context, { prompt: 'continue', session: 'session-old' });

  assert.deepEqual(result, { accepted: true, session: 'session-next' });
  assert.deepEqual(calls[0].args, [
    'exec',
    'resume',
    'session-old',
    '--json',
    '--model',
    'gpt-5-codex',
    '--config',
    'model_reasoning_effort=high',
    'continue',
  ]);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('CodexHarness rejects successful output without a session ID', async () => {
  const harness = codexHarness({ stdout: ['{"type":"message"}\n'] }, []);

  await assert.rejects(
    () => harness.start(context, { prompt: 'missing id' }),
    /Codex completed without a valid session ID for issue #114/,
  );
});

test('CodexHarness distinguishes pre-turn rejection from an ambiguous started failure', async () => {
  const rejected = codexHarness({ stderr: ['invalid session\n'], code: 1 }, []);
  await assert.rejects(
    () => rejected.resume(context, { prompt: 'retry me', session: 'rejected' }),
    ResumeRejectedError,
  );

  const ambiguous = codexHarness({ stdout: ['{"type":"started"}\n'], code: 1 }, []);
  await assert.rejects(
    () => ambiguous.start(context, { prompt: 'do not retry' }),
    ResumeAmbiguousError,
  );
});

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
