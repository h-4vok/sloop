import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  ResumeAmbiguousError,
  CodexHarness,
  ResumeRejectedError,
  SessionStore,
  runHarnessTurn,
} from '../src/harness.js';

function createMockCodexProcess({ stdout = [], stderr = [], code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = { end: (chunk) => (child.input = chunk) };
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

function createMockCodexHarness(response, calls, logs = []) {
  return new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    log: (source, chunk) => logs.push([source, chunk]),
    spawn: (file, args, options) => {
      const child = createMockCodexProcess(response);
      calls.push({ file, args, options, child });
      return child;
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
function getLaunchedCodexArgs(call) {
  if (call.child.input === undefined) return call.args;
  const lines = call.child.input.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

test('CodexHarness starts with typed CLI options, extracts the session, and logs raw output', async () => {
  const calls = [];
  const logs = [];
  const harness = createMockCodexHarness(
    {
      stdout: ['{"type":"thread.started","thread_id":"session-start"}\n', '{"type":"message"}\n'],
      stderr: ['diagnostic\n'],
    },
    calls,
    logs,
  );

  const result = await harness.start(context, { prompt: 'do the work' });

  assert.deepEqual(result, { accepted: true, session: 'session-start' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.deepEqual(getLaunchedCodexArgs(calls[0]), [
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
  assert.ok(getLaunchedCodexArgs(calls[0]).every((arg) => arg.length > 0));
  assert.deepEqual(logs, [
    ['stdout', '{"type":"thread.started","thread_id":"session-start"}\n'],
    ['stdout', '{"type":"message"}\n'],
    ['stderr', 'diagnostic\n'],
  ]);
  assert.equal(calls[0].options.cwd, 'fixture-repository');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, [
    process.platform === 'win32' ? 'pipe' : 'ignore',
    'pipe',
    'pipe',
  ]);
  if (process.platform === 'win32')
    assert.match(
      Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le'),
      /Get-Command codex\.exe/,
    );
});

test('CodexHarness returns completed agent messages as the turn output', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
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

test('CodexHarness accepts session IDs from alternate JSON event shapes', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
    { stdout: ['{"session_id":"session-alternate"}\n'] },
    calls,
  );

  const result = await harness.start(context, { prompt: 'read alternate session field' });

  assert.deepEqual(result, { accepted: true, session: 'session-alternate' });
});

test('CodexHarness resumes the supplied opaque session and accepts a replacement', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
    { stdout: ['{"type":"thread.started","thread_id":"session-next"}\n'] },
    calls,
  );

  const result = await harness.resume(context, { prompt: 'continue', session: 'session-old' });

  assert.deepEqual(result, { accepted: true, session: 'session-next' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.deepEqual(getLaunchedCodexArgs(calls[0]), [
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
  assert.deepEqual(calls[0].options.stdio, [
    process.platform === 'win32' ? 'pipe' : 'ignore',
    'pipe',
    'pipe',
  ]);
});

test('CodexHarness rejects resume requests without a session reference', () => {
  const harness = createMockCodexHarness({ stdout: [] }, []);

  assert.throws(
    () => harness.resume(context, { prompt: 'resume without a reference', session: '' }),
    ResumeRejectedError,
  );
});

test('CodexHarness rejects successful output without a session ID', async () => {
  const harness = createMockCodexHarness({ stdout: ['{"type":"message"}\n'] }, []);

  await assert.rejects(
    () => harness.start(context, { prompt: 'missing id' }),
    /Codex completed without a valid session ID for issue #114/,
  );
});

test('CodexHarness distinguishes pre-turn rejection from an ambiguous started failure', async () => {
  const rejected = createMockCodexHarness({ stderr: ['invalid session\n'], code: 1 }, []);
  await assert.rejects(
    () => rejected.resume(context, { prompt: 'retry me', session: 'rejected' }),
    ResumeRejectedError,
  );

  const ambiguous = createMockCodexHarness({ stdout: ['{"type":"started"}\n'], code: 1 }, []);
  await assert.rejects(
    () => ambiguous.start(context, { prompt: 'do not retry' }),
    ResumeAmbiguousError,
  );
});

test('CodexHarness kills timed-out processes and rejects spawn errors', async () => {
  const timedOutChild = new EventEmitter();
  timedOutChild.stdout = new EventEmitter();
  timedOutChild.stderr = new EventEmitter();
  timedOutChild.stdin = { end: () => {} };
  timedOutChild.kill = () => queueMicrotask(() => timedOutChild.emit('close', null));
  const timedOutHarness = new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1,
    spawn: () => timedOutChild,
  });

  await assert.rejects(
    () => timedOutHarness.start(context, { prompt: 'wait for timeout' }),
    ResumeRejectedError,
  );

  const failedChild = new EventEmitter();
  failedChild.stdout = new EventEmitter();
  failedChild.stderr = new EventEmitter();
  failedChild.stdin = { end: () => {} };
  failedChild.kill = () => {};
  const failedHarness = new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    spawn: () => {
      queueMicrotask(() => failedChild.emit('error', new Error('spawn failed')));
      return failedChild;
    },
  });

  await assert.rejects(
    () => failedHarness.start(context, { prompt: 'fail to spawn' }),
    /spawn failed/,
  );
});

test('CodexHarness kills a child process when its output streams are unavailable', async () => {
  const childWithoutOutput = new EventEmitter();
  childWithoutOutput.stderr = new EventEmitter();
  childWithoutOutput.kill = () => {
    childWithoutOutput.wasKilled = true;
  };
  const harness = new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    spawn: () => childWithoutOutput,
  });

  await assert.rejects(
    () => harness.start(context, { prompt: 'missing streams' }),
    /Codex process streams were not created/,
  );
  assert.equal(childWithoutOutput.wasKilled, true);
});

test('resumes the stored session for the same run issue and role', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-'));
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

  const persisted = JSON.parse(await readFile(join(root, 'sessions.json'), 'utf8'));

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

test('session store rejects keys without a valid run identifier', async () => {
  const store = new SessionStore(join(tmpdir(), 'sloop-invalid-session-key.json'));

  await assert.rejects(
    () => store.get({ run: ' ', issue: 114, role: 'worker' }),
    /session key requires a run, positive issue, and role/,
  );
});

test('session store reports malformed persisted JSON instead of treating it as missing', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-invalid-json-'));
  const sessionFile = join(root, 'sessions.json');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(sessionFile, '{invalid'));
  const store = new SessionStore(sessionFile);

  await assert.rejects(() => store.get({ run: 'run-a', issue: 114, role: 'worker' }), SyntaxError);
});

test('starts a separate session for a different run key', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-'));
  const store = new SessionStore(join(root, 'sessions.json'));
  const calls = [];
  const harness = {
    capabilities: { sessions: true },
    async start(_, turn) {
      calls.push(['start', turn]);
      return { accepted: true, session: `session-${turn.run}` };
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
    { run: 'run-b', issue: 114, role: 'worker' },
    { ...context, run: 'run-b' },
    'other',
  );

  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['start', 'start'],
  );
});

test('falls back with full context after a pre-turn resume rejection', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-'));
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
});

test('preserves stored sessions when resume outcome is ambiguous', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-'));
  const file = join(root, 'sessions.json');
  const store = new SessionStore(file);
  const initial = {
    capabilities: { sessions: true },
    async start() {
      return { accepted: true, session: 'stored' };
    },
  };

  await runHarnessTurn(
    initial,
    store,
    { run: 'r', issue: 1, role: 'qa' },
    { ...context, run: 'r', issue: 1, role: 'qa' },
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
  const resumeAmbiguousSession = runHarnessTurn(
    ambiguous,
    new SessionStore(file),
    { run: 'r', issue: 1, role: 'qa' },
    { ...context, run: 'r', issue: 1, role: 'qa' },
    'ambiguous',
  );

  await assert.rejects(resumeAmbiguousSession, ResumeAmbiguousError);
});

test('sessionless harness receives fresh invocations without a persisted reference', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-harness-'));
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
