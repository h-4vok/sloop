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

const createWorkerEnvelope = () => ({
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'worker',

  status: 'ready',

  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

test('runner exposes the canonical schema for every agent role', async () => {
  let observedSchema;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),

    execute: async (_command, _args, options) => {
      observedSchema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('input', context);

  assert.equal(result.status, 'ready');
  assert.ok(observedSchema.$defs.worker);
  assert.ok(observedSchema.$defs.reviewer);
  assert.ok(observedSchema.$defs.arbiter);
  assert.equal(observedSchema.$id, 'sloop.agent-output/v1');
  assert.equal(observedSchema.oneOf.length, 3);
  assert.deepEqual(
    observedSchema.oneOf.map((branch) => branch.properties.producer),
    [{ const: 'worker' }, { enum: ['qa', 'staff'] }, { const: 'arbiter' }],
  );
});
