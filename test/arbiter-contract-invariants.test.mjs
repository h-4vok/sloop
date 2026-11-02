import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  applyArbiterDecisions,
  followUpEligible,
  followUpKey,
  shouldInvokeArbiter,
  validateArbiterDecisions,
} from '../src/arbiter-contracts.js';

for (const action of ['uphold', 'overrule', 'defer', 'escalate']) {
  test(`Arbiter ${action} accepts its structural contract without grading rationale vocabulary`, () => {
    // Arrange
    const findings = [{ id: 'Q1', owner: 'qa', summary: 'Trim surrounding whitespace' }];
    const decision = {
      findingId: 'Q1',

      owner: 'qa',

      action,

      rationale: 'El requisito exige recortar los espacios.',

      direction: action === 'uphold' ? 'Trim the input.' : null,

      verification: action === 'uphold' ? 'Check surrounding and internal spaces.' : null,

      followUp:
        action === 'defer'
          ? {
              title: 'Trim names',

              acceptance: 'Surrounding spaces are removed.',

              context: 'Issue #41 / Q1',
            }
          : null,
    };
    // Act
    const state = applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, [decision]);
    // Assert
    assert.equal(state.interventions, 1);
    assert.equal(state.decisions[0].action, action);
    assert.equal(state.decisions[0].rationale, decision.rationale);
    assert.equal(state.terminal, action === 'escalate' ? 'human_review_required' : undefined);
    assert.equal(state.decisions[0].followUp, decision.followUp ?? undefined);
  });
}

test('arbiter decisions stop when the intervention limit has been reached', () => {
  const currentState = { interventions: 2, decisions: [] };
  const findings = [];

  assert.throws(
    () => applyArbiterDecisions(currentState, findings, [], 2),
    /arbiter intervention limit reached/,
  );
});

const malformedDecisions = [
  ['null decision', null],
  ['array decision', []],
  ['unknown field', { extra: true }],
  ['unknown finding', { findingId: 'Q2' }],
  ['wrong owner', { owner: 'worker' }],
  ['non-string owner', { owner: 1 }],
  ['unknown action', { action: 'accept' }],
  ['non-string rationale', { rationale: 4 }],
  ['empty rationale', { rationale: ' ' }],
  ['non-string direction', { direction: 4 }],
  ['non-string verification', { verification: false }],
  ['null uphold direction', { action: 'uphold', direction: null, verification: 'Check names.' }],
  ['empty uphold direction', { action: 'uphold', direction: ' ', verification: 'Check names.' }],
  ['missing uphold verification', { action: 'uphold', direction: 'Trim names.' }],
  ['empty uphold verification', { action: 'uphold', direction: 'Trim names.', verification: ' ' }],
  ['missing defer follow-up', { action: 'defer' }],
  ['string follow-up', { action: 'defer', followUp: 'later' }],
  ['array follow-up', { action: 'defer', followUp: [] }],
  ['incomplete follow-up', { action: 'defer', followUp: { title: 'Trim names' } }],
  [
    'empty follow-up',
    { action: 'defer', followUp: { title: ' ', acceptance: 'Trim.', context: 'Q1' } },
  ],
  [
    'unknown follow-up field',
    {
      action: 'defer',

      followUp: { title: 'Trim', acceptance: 'Trim.', context: 'Q1', extra: true },
    },
  ],
];
for (const [condition, patch] of malformedDecisions) {
  test(`Arbiter rejects ${condition} before applying a ruling`, () => {
    // Arrange
    const findings = [{ id: 'Q1', owner: 'qa', summary: 'Trim names' }];
    const decision =
      patch === null || Array.isArray(patch)
        ? patch
        : {
            findingId: 'Q1',

            owner: 'qa',

            action: 'overrule',

            rationale: 'Outside the agreed scope.',

            ...patch,
          };
    // Act / Assert
    assert.throws(() =>
      applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, [decision]),
    );
  });
}
