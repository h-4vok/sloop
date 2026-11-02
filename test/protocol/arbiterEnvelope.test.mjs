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
    direction: 'Trim input.',
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

test('agent envelope accepts a blocked Worker result', () => {
  const envelope = {
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

  assert.equal(validateAgentEnvelope(envelope, context).status, 'blocked');
});

test('agent envelope accepts QA and staff review results', () => {
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

  assert.equal(validateAgentEnvelope(reviewer, context).status, 'accepted');
  assert.equal(
    validateAgentEnvelope({ ...reviewer, producer: 'staff', status: 'changes-requested' }, context)
      .producer,
    'staff',
  );
});

test('agent envelope accepts Arbiter decision statuses', () => {
  const arbiter = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'arbiter',
    status: 'uphold',
    payload: { rationale: 'rationale', references: ['Q1'], decisions },
  };

  for (const status of ['uphold', 'overrule', 'defer']) {
    assert.equal(validateAgentEnvelope({ ...arbiter, status }, context).status, status);
  }
});

test('agent envelope rejects invalid contract boundaries', () => {
  const base = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'arbiter',
    status: 'uphold',
    payload: { rationale: 'r', references: ['Q1'], decisions },
  };
  const invalidEnvelopes = [
    null,
    { ...base, schema: 'v2' },
    { ...base, context: { ...context, issue: 0 } },
    { ...base, producer: 'other' },
    { ...base, status: 'other' },
    { ...base, payload: { rationale: '', references: ['Q1'], decisions } },
    { ...base, payload: { rationale: 'r', references: [], decisions } },
  ];

  for (const envelope of invalidEnvelopes) {
    assert.throws(() => validateAgentEnvelope(envelope, context), AgentContractError);
  }
});
