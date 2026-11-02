import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

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

test('arbitrary runner reads only the declared result, captures streams, and retries launch failures', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-test-'));
  const logs = [];
  let attempts = 0;
  const runner = new ArbitraryCommandRunner('missing', [], {
    cwd: root,

    retries: 1,

    log: (source, chunk) => logs.push([source, chunk]),

    execute: async (_cmd, _args, options) => {
      attempts++;
      options.onStdout('{"status":"blocked"}');
      options.onStderr('diagnostic');
      if (attempts === 1) throw new Error('ENOENT');
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('{"instruction":"do it"}', context);

  assert.equal(result.status, 'ready');
  assert.equal(attempts, 2);
  assert.deepEqual(logs, [
    ['stdout', '{"status":"blocked"}'],
    ['stderr', 'diagnostic'],
    ['stdout', '{"status":"blocked"}'],
    ['stderr', 'diagnostic'],
  ]);
});

test('default process adapter reports a timeout as an operational failure', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-timeout-'));
  const runner = new ArbitraryCommandRunner(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 1000)'],
    { cwd: root, timeoutMs: 10 },
  );

  await assert.rejects(
    () => runner.run('input', context),
    (error) => {
      assert.ok(error instanceof AgentContractError);
      assert.equal(error.code, 'operational-failure');
      return true;
    },
  );
});

test('non-interactive Codex structured-output smoke uses declared paths and one validated result', async () => {
  const events = [];
  let invocation;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),

    model: 'smoke-model',

    sandbox: 'read-only',

    timeoutMs: 1000,

    execute: async (command, args, options) => {
      invocation = { command, args, stdin: options.stdin };
      events.push(['argv', args]);
      const schema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      assert.equal(schema.$id, 'sloop.agent-output/v1');
      assert.ok(options.env.SLOOP_AGENT_INPUT.endsWith('input.json'));
      assert.ok(options.env.SLOOP_AGENT_OUTPUT.endsWith('output.json'));
      options.onStdout('diagnostic marker: {"status":"blocked"}');
      options.onStderr('isolated smoke diagnostic');
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },

    log: (source, chunk) => events.push([source, chunk]),
  });
  const result = await runner.run('non-interactive smoke prompt', context);

  assert.equal(invocation.command, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  const codexArgs = decodeForwardedArguments(invocation.stdin, invocation.args);
  assert.equal(result.schema, 'sloop.agent-output/v1');
  assert.equal(result.status, 'ready');
  assert.equal(events[1][0], 'stdout');
  assert.equal(events[2][0], 'stderr');
  assert.ok(codexArgs.includes('--output-schema'));
  assert.ok(codexArgs.includes('--output-last-message'));
});
