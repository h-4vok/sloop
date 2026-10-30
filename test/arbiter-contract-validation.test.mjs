import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  applyArbiterDecisions,
  followUpEligible,
  followUpKey,
  shouldInvokeArbiter,
  validateArbiterDecisions,
} from '../src/arbiter-contracts.js';

test('Arbiter rejects duplicate decisions for an open finding', () => {
  const findings = [
    { id: 'Q1', owner: 'qa', summary: 'Names' },
    { id: 'Q2', owner: 'qa', summary: 'Spaces' },
  ];
  const decision = {
    findingId: 'Q1',

    owner: 'qa',

    action: 'overrule',

    rationale: 'Outside scope.',
  };

  assert.throws(
    () => validateArbiterDecisions(findings, [decision, decision], 1),
    /finding id and owner/,
  );
});

test('Arbiter rejects uphold on the second intervention', () => {
  const findings = [{ id: 'Q1', owner: 'qa', summary: 'Names' }];
  const decision = {
    findingId: 'Q1',

    owner: 'qa',

    action: 'uphold',

    rationale: 'Trim names.',

    direction: 'Trim.',

    verification: 'Check spaces.',
  };

  assert.throws(() => validateArbiterDecisions(findings, [decision], 2), /invalid action/);
});

test('terminating arbiter validates complete atomic mixed decisions and follow-up readiness', () => {
  const findings = [
    { id: 'Q1', owner: 'qa', summary: 'scope' },
    { id: 'S1', owner: 'staff', summary: 'ux' },
  ];
  const rationale =
    'Conflict: both arguments matter. Analysis against contract, product and UX justifies this action.';

  assert.equal(shouldInvokeArbiter({ substantiveRounds: 2, findingAppearances: 1 }), false);
  assert.equal(shouldInvokeArbiter({ substantiveRounds: 3, findingAppearances: 0 }), true);
  const raw = [
    {
      findingId: 'Q1',

      owner: 'qa',

      action: 'uphold',

      rationale,

      direction: 'fix it',

      verification: 'test it',
    },
    {
      findingId: 'S1',

      owner: 'staff',

      action: 'defer',

      rationale,

      followUp: { title: 'later', acceptance: 'contract', context: 'source' },
    },
  ];
  const state = applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, raw);
  assert.equal(state.decisions.length, 2);
  assert.equal(followUpKey(41, 'S1'), 'sloop/arbiter/follow-up/41/S1');
  assert.equal(followUpEligible(false, true), false);
  assert.equal(followUpEligible(true, true), true);
  assert.throws(() => validateArbiterDecisions(findings, raw.slice(0, 1), 1));
  assert.throws(() => applyArbiterDecisions({ ...state, interventions: 1 }, findings, raw));
});
