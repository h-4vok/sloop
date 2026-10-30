import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFile as readFileFromFs } from 'node:fs/promises';

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

const createWorkerEnvelope = () => ({
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'worker',

  status: 'ready',

  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

test('runner retries a failed process before returning a valid result', async () => {
  let attempts = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),

    retries: 1,

    execute: async (_command, _args, options) => {
      attempts++;
      if (attempts === 1) return { stdout: '', stderr: 'crash', code: 1, signal: null };
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('input', context);

  assert.equal(result.status, 'ready');
  assert.equal(attempts, 2);
});

test('runner returns a persisted valid result without executing a duplicate attempt', async () => {
  let calls = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),

    execute: async (_command, _args, options) => {
      calls++;
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const firstResult = await runner.run('input', context);
  const secondResult = await runner.run('input', context);

  assert.equal(firstResult.status, 'ready');
  assert.equal(secondResult.status, 'ready');
  assert.equal(calls, 1);
});

test('declared schema resolves canonical role refs and reconciliation survives a new runner', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-persist-'));
  const reconciliationDir = join(root, 'results');
  let calls = 0;
  const execute = async (_command, _args, options) => {
    calls++;
    const schema = JSON.parse(await readFileFromFs(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
    assert.ok(schema.$defs.worker);
    for (const file of ['worker.v1.json', 'reviewer.v1.json', 'arbiter.v1.json']) {
      assert.ok(await readFileFromFs(join(options.env.SLOOP_AGENT_SCHEMA, '..', file), 'utf8'));
    }
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
    );
    return { stdout: '', stderr: '', code: 0, signal: null };
  };
  const first = new ArbitraryCommandRunner('fake', [], { cwd: root, reconciliationDir, execute });

  assert.equal((await first.run('persisted input', context)).status, 'ready');
  const second = new ArbitraryCommandRunner('fake', [], {
    cwd: root,

    reconciliationDir,

    execute: async () => {
      throw new Error('must reconcile without execution');
    },
  });
  assert.equal((await second.run('persisted input', context)).status, 'ready');
  assert.equal(calls, 1);
});
