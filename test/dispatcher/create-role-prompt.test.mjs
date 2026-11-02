import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRolePrompt } from '../../src/application/dispatcher/services/createRolePrompt.ts';

test('role prompt creates staff review instructions for the staff role', () => {
  // Arrange
  const issue = { number: 42, title: 'Review implementation', body: 'Acceptance criteria.' };

  // Act
  const prompt = createRolePrompt(issue, 'staff', 17, 2, '', '', 'abc123', 'run-1');

  // Assert
  assert.match(prompt, /staff-reviewer skill/);
  assert.match(prompt, /issue #42: Review implementation/);
  assert.match(prompt, /PR #17 against main/);
  assert.match(prompt, /Current head is abc123/);
});
