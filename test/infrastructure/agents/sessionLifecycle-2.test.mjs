import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

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

test('runner reports non-Error launch failures and rethrows durable write failures', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-durable-error-'));
  const launch = new ArbitraryCommandRunner('fake', [], {
    cwd: root,

    execute: async () => {
      throw 'missing executable';
    },
  });
  await assert.rejects(launch.run('launch', context), (error) =>
    /runner launch failed/.test(error.message),
  );
  const durable = new ArbitraryCommandRunner('fake', [], {
    cwd: root,

    reconciliationDir: join(root, 'results'),

    writeReconciliation: async () => {
      const error = new Error('cannot persist');
      Object.assign(error, { code: 'EACCES' });
      throw error;
    },

    execute: async (_command, _args, options) => {
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await assert.rejects(durable.run('durable', context), (error) => error.code === 'malformed');
});
