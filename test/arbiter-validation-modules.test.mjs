import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateArbiterDecisions } from '../src/arbiter-contracts/validateArbiterDecisions.ts';

test('decision validation accepts a complete ruling and returns structured errors', () => {
  // Arrange
  const findings = [{ id: 'Q1', owner: 'qa', summary: 'Trim whitespace' }];
  const validDecision = [
    {
      findingId: 'Q1',
      owner: 'qa',
      action: 'uphold',
      rationale: 'The contract requires trimming.',
      direction: 'Trim surrounding whitespace.',
      verification: 'Check leading and trailing spaces.',
    },
  ];
  const wrongOwnerDecision = [{ ...validDecision[0], owner: 'worker' }];

  // Act
  const valid = validateArbiterDecisions(findings, validDecision, 1);
  const invalid = validateArbiterDecisions(findings, wrongOwnerDecision, 1);

  // Assert
  assert.equal(valid.ok, true);
  assert.equal(valid.value[0].findingId, 'Q1');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error.message, /preserve finding id and owner/);
});
