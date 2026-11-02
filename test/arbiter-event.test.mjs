import assert from 'node:assert/strict';
import { test } from 'vitest';
import { event } from '../src/arbiter.js';

test('event adds a stable identity and timestamp to producer input', () => {
  // Arrange
  const eventInput = {
    sessionId: 'session-1',

    issue: 1,

    role: 'arbiter',

    round: 2,

    type: 'review_started',

    payload: {},
  };
  const beforeEmission = Date.now();

  // Act
  const emittedEvent = event(eventInput);
  const { id, emittedAt, ...emittedFields } = emittedEvent;

  // Assert
  assert.deepEqual(emittedFields, eventInput);
  assert.equal(typeof id, 'string');
  assert.ok(Date.parse(emittedAt) >= beforeEmission);
});
