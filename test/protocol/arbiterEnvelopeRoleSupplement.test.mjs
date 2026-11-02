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

test('agent envelope rejects each role-specific invalid boundary', () => {
  const worker = {
    schema: 'sloop.agent-output/v1',

    context: { ...context, pr: undefined },

    producer: 'worker',

    status: 'ready',

    payload: { summary: 's', findingResolutions: [], verification: ['v'], guide },
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

  assert.equal(validateAgentEnvelope(worker).context.pr, undefined);
  for (const value of [
    { ...worker, context: { ...worker.context, issue: 1.5 } },
    { ...worker, context: { ...worker.context, round: 0 } },
    { ...worker, context: { ...worker.context, pr: 0 } },
    { ...worker, context: { ...worker.context, pr: 1.5 } },
    { ...worker, status: 'accepted' },
    { ...worker, payload: { ...worker.payload, findingResolutions: ['not-a-record'] } },
    { ...worker, payload: { ...worker.payload, guide: { ...guide, steps: [] } } },
    { ...worker, payload: { ...worker.payload, guide: { ...guide, expected: [''] } } },
    { ...reviewer, status: 'ready' },
    {
      ...reviewer,

      payload: {
        ...reviewer.payload,

        dispositions: [{ id: 'missing', status: 'fixed', summary: 's' }],
      },
    },
    { ...reviewer, producer: 'arbiter', status: 'accepted' },
  ])
    assert.throws(() => validateAgentEnvelope(value), AgentContractError);
});
