import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentContractError,
  ArbitraryCommandRunner,
  CodexAgentRunner,
  validateAgentEnvelope,
} from '../dist/agent-runner.js';

const context = { run: 'run-36', issue: 36, pr: 77, round: 2, sha: 'abc123', cursor: 'cursor' };
const guide = {
  summary: 'verify',
  steps: ['run'],
  expected: ['pass'],
  isolation: 'temp',
  limitations: ['fake'],
  checklist: ['check'],
};
const worker = () => ({
  schema: 'sloop.agent-output/v1',
  context,
  producer: 'worker',
  status: 'ready',
  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

test('validates every role and rejects incomplete or contradictory payloads', () => {
  assert.equal(validateAgentEnvelope(worker(), context).status, 'ready');
  assert.throws(
    () =>
      validateAgentEnvelope(
        { ...worker(), producer: 'qa', status: 'accepted', payload: {} },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () =>
      validateAgentEnvelope(
        {
          ...worker(),
          producer: 'arbiter',
          status: 'uphold',
          payload: { rationale: 'r', references: [] },
        },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () =>
      validateAgentEnvelope(
        { ...worker(), payload: { ...worker().payload, extra: true } },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () => validateAgentEnvelope({ ...worker(), context: { ...context, sha: 'stale' } }, context),
    AgentContractError,
  );
});

test('arbitrary runner reads only the declared result, captures streams, and retries launch failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-test-'));
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
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
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

test('Codex runner builds separated structured-output argv and captures a result', async () => {
  let seen;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    model: 'm',
    reasoningEffort: 'high',
    sandbox: 'read-only',
    execute: async (command, args, options) => {
      seen = [command, args];
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      options.onStdout('marker-like json');
      options.onStderr('diagnostic');
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  assert.equal((await runner.run('prompt', context)).status, 'ready');
  assert.equal(seen[0], 'codex');
  assert.deepEqual(seen[1].slice(0, 8), [
    'exec',
    '--cd',
    process.cwd(),
    '--sandbox',
    'read-only',
    '--output-schema',
    seen[1][6],
    '--output-last-message',
  ]);
  assert.ok(seen[1].includes('prompt'));
});

test('runner exposes the complete canonical schema and rejects operational failure matrix', async () => {
  const seen = [];
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    retries: 1,
    timeoutMs: 5,
    execute: async (_command, _args, options) => {
      seen.push(JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8')));
      if (seen.length === 1) return { stdout: '', stderr: 'crash', code: 1, signal: null };
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, '{"schema":"sloop.agent-output/v1"'),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await assert.rejects(runner.run('input', context), (error) => error.code === 'malformed');
  assert.equal(seen.length, 2);
  assert.ok(seen[0].$defs.worker);
  assert.ok(seen[0].$defs.reviewer);
  assert.ok(seen[0].$defs.arbiter);
  assert.equal(seen[0].$id, 'sloop.agent-output/v1');
});

test('runner handles timeout, missing output, duplicate members, and idempotent valid retry', async () => {
  for (const mode of ['timeout', 'missing', 'duplicate']) {
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
    await assert.rejects(runner.run('input', context), (error) =>
      ['operational-failure', 'missing-result', 'malformed'].includes(error.code),
    );
  }
  let calls = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    execute: async (_command, _args, options) => {
      calls++;
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  assert.equal((await runner.run('input', context)).status, 'ready');
  assert.equal((await runner.run('input', context)).status, 'ready');
  assert.equal(calls, 1);
});
