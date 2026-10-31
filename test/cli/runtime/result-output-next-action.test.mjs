import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resultOutput } from '../../../src/application/cli/runtime/ResultOutput.ts';

test('result output reads the next action from an object result', () => {
  // Arrange
  const nextAction = { command: 'sloop doctor', mutates: false };
  const result = { nextAction };

  // Act
  const actualNextAction = resultOutput.readNextAction(result);

  // Assert
  assert.equal(actualNextAction, nextAction);
});
