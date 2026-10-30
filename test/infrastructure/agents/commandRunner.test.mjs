import { test } from 'vitest';

import assert from 'node:assert/strict';

import {
  AgentContractError,
  ArbitraryCommandRunner,
  CodexAgentRunner,
  validateAgentEnvelope,
} from '../../../src/agent-runner.js';

const context = { run: 'run-36', issue: 36, pr: 77, round: 2, sha: 'abc123', cursor: 'cursor' };

const guide = {
  summary: 'verify',

  steps: ['run'],

  expected: ['pass'],

  isolation: 'temp',

  limitations: ['fake'],

  checklist: ['check'],
};

function decodeForwardedArguments(stdin, args) {
  if (stdin === undefined) return args;
  const lines = stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

const createWorkerEnvelope = () => ({
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'worker',

  status: 'ready',

  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

for (const [condition, payload] of [
  ['missing decisions', { rationale: 'Trim names.', references: ['Q1'] }],
  ['empty decisions', { rationale: 'Trim names.', references: ['Q1'], decisions: [] }],
  ['malformed decisions', { rationale: 'Trim names.', references: ['Q1'], decisions: [null] }],
  ['empty references', { rationale: 'Trim names.', references: [], decisions: [{}] }],
]) {
  test(`Arbiter envelope rejects ${condition}`, () => {
    const envelope = { ...createWorkerEnvelope(), producer: 'arbiter', status: 'uphold', payload };

    assert.throws(() => validateAgentEnvelope(envelope, context), AgentContractError);
  });
}

test('Codex runner builds separated structured-output argv and captures a result', async () => {
  let seen;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),

    model: 'm',

    reasoningEffort: 'high',

    sandbox: 'read-only',

    execute: async (command, args, options) => {
      seen = [command, args, options.stdin];
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      options.onStdout('marker-like json');
      options.onStderr('diagnostic');
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });

  assert.equal((await runner.run('prompt', context)).status, 'ready');
  assert.equal(seen[0], process.platform === 'win32' ? 'powershell.exe' : 'codex');
  const codexArgs = decodeForwardedArguments(seen[2], seen[1]);
  assert.ok(codexArgs.every((arg) => arg.length > 0));
  assert.deepEqual(codexArgs.slice(0, 7), [
    'exec',
    '--cd',
    process.cwd(),
    '--sandbox',
    'read-only',
    '--output-schema',
    codexArgs[6],
  ]);
  assert.ok(codexArgs.includes('prompt'));
});

for (const [condition, expectedCode, mode] of [
  ['a timed-out process', 'operational-failure', 'timeout'],
  ['a missing result file', 'missing-result', 'missing'],
  ['duplicate JSON members', 'malformed', 'duplicate'],
]) {
  test(`runner rejects ${condition}`, async () => {
    const runner = new ArbitraryCommandRunner('fake', [], {
      cwd: process.cwd(),

      timeoutMs: 1,

      execute: async (_command, _args, options) => {
        if (mode === 'timeout') return { stdout: '', stderr: '', code: null, signal: 'SIGTERM' };
        if (mode === 'duplicate')
          await import('node:fs/promises').then(({ writeFile }) =>
            writeFile(options.env.SLOOP_AGENT_OUTPUT, '{"schema":1,"schema":2}'),
          );
        return { stdout: '', stderr: '', code: 0, signal: null };
      },
    });
    const execution = runner.run('input', context);

    await assert.rejects(execution, (error) => error.code === expectedCode);
  });
}

test('Codex runner applies its default sandbox', async () => {
  let args;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),

    execute: async (_command, received, options) => {
      args = decodeForwardedArguments(options.stdin, received);
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          options.env.SLOOP_AGENT_OUTPUT,
          JSON.stringify({ ...createWorkerEnvelope(), context: { ...context, pr: undefined } }),
        ),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await runner.run('default sandbox', { ...context, pr: undefined });

  assert.equal(args[4], 'workspace-write');
});
