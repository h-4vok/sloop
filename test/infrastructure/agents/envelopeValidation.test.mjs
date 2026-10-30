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

test('accepts a complete Worker envelope', () => {
  const workerEnvelope = createWorkerEnvelope();

  const result = validateAgentEnvelope(workerEnvelope, context);

  assert.equal(result.status, 'ready');
});

test('rejects an incomplete QA envelope', () => {
  const invalidQaEnvelope = {
    ...createWorkerEnvelope(),

    producer: 'qa',

    status: 'accepted',

    payload: {},
  };

  const validateInvalidQaEnvelope = () => validateAgentEnvelope(invalidQaEnvelope, context);

  assert.throws(validateInvalidQaEnvelope, AgentContractError);
});

test('rejects an Arbiter envelope with no finding references', () => {
  const invalidArbiterEnvelope = {
    ...createWorkerEnvelope(),

    producer: 'arbiter',

    status: 'uphold',

    payload: { rationale: 'r', references: [] },
  };

  const validateInvalidArbiterEnvelope = () =>
    validateAgentEnvelope(invalidArbiterEnvelope, context);

  assert.throws(validateInvalidArbiterEnvelope, AgentContractError);
});

test('rejects Worker payload fields outside the declared schema', () => {
  const workerEnvelope = createWorkerEnvelope();
  const invalidWorkerEnvelope = {
    ...workerEnvelope,

    payload: { ...workerEnvelope.payload, extra: true },
  };

  const validateUnexpectedPayloadField = () =>
    validateAgentEnvelope(invalidWorkerEnvelope, context);

  assert.throws(validateUnexpectedPayloadField, AgentContractError);
});

test('rejects an agent envelope with a stale context SHA', () => {
  const staleContextEnvelope = {
    ...createWorkerEnvelope(),

    context: { ...context, sha: 'stale' },
  };

  const validateStaleContextEnvelope = () => validateAgentEnvelope(staleContextEnvelope, context);

  assert.throws(validateStaleContextEnvelope, AgentContractError);
});

test('arbitrary runner executes the production child-process adapter for a valid envelope', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-default-exec-'));
  const payload = JSON.stringify(createWorkerEnvelope());
  const script = [
    "const fs = require('node:fs');",
    "process.stdout.write('started');",
    "process.stderr.write('diagnostic');",
    `fs.writeFileSync(process.env.SLOOP_AGENT_OUTPUT, ${JSON.stringify(payload)});`,
  ].join('');
  const logs = [];
  const runner = new ArbitraryCommandRunner(process.execPath, ['-e', script], {
    cwd: root,

    log: (source, chunk) => logs.push([source, chunk]),
  });

  assert.equal((await runner.run('production adapter', context)).status, 'ready');
  assert.deepEqual(logs, [
    ['stdout', 'started'],
    ['stderr', 'diagnostic'],
  ]);
});
