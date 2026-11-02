import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AgentContractError, validateAgentEnvelope } from '../../src/agent-runner.js';
const context = { run: 'r', issue: 7, pr: 8, round: 1, sha: 'abcdef1', cursor: 'c' };
const decisions = [
  {
    findingId: 'Q1',
    owner: 'qa',
    action: 'uphold',
    rationale: 'Trim names.',
    direction: 'Trim the input.',
    verification: 'Check surrounding whitespace.',
    followUp: null,
  },
];
const guide = {
  summary: 'summary',
  steps: ['step'],
  expected: ['expected'],
  isolation: 'isolated',
  limitations: ['none'],
  checklist: ['checked'],
};

test('agent envelope accepts every producer contract and valid status family', () => {
  const worker = {
    schema: 'sloop.agent-output/v1',

    context,

    producer: 'worker',

    status: 'blocked',

    payload: {
      summary: 's',

      findingResolutions: [{ id: 'Q1', status: 'fixed', summary: 's' }],

      verification: ['v'],

      guide,
    },
  };
  const reviewer = {
    schema: 'sloop.agent-output/v1',

    context,

    producer: 'qa',

    status: 'accepted',

    payload: {
      summary: 's',

      evidence: ['e'],

      newFindings: [{ id: 'Q1', summary: 's', severity: 'low' }],

      dispositions: [{ id: 'Q1', status: 'fixed', summary: 's' }],
    },
  };
  const arbiter = {
    schema: 'sloop.agent-output/v1',

    context,

    producer: 'arbiter',

    status: 'uphold',

    payload: { rationale: 'rationale', references: ['Q1'], decisions },
  };

  assert.equal(validateAgentEnvelope(worker, context).status, 'blocked');
  assert.equal(
    validateAgentEnvelope({ ...reviewer, producer: 'staff', status: 'changes-requested' }, context)
      .producer,
    'staff',
  );
  assert.equal(validateAgentEnvelope(reviewer, context).status, 'accepted');
  assert.equal(validateAgentEnvelope(arbiter, context).status, 'uphold');
  for (const status of ['overrule', 'defer'])
    assert.equal(validateAgentEnvelope({ ...arbiter, status }, context).status, status);
});

test('agent envelope rejects each invalid contract boundary', () => {
  const base = {
    schema: 'sloop.agent-output/v1',

    context,

    producer: 'arbiter',

    status: 'uphold',

    payload: { rationale: 'r', references: ['Q1'], decisions },
  };

  for (const value of [
    null,
    { ...base, schema: 'v2' },
    { ...base, context: { ...context, issue: 0 } },
    { ...base, producer: 'other' },
    { ...base, status: 'other' },
    { ...base, payload: { rationale: '', references: ['Q1'], decisions } },
    { ...base, payload: { rationale: 'r', references: [], decisions } },
  ])
    assert.throws(() => validateAgentEnvelope(value, context), AgentContractError);
});
