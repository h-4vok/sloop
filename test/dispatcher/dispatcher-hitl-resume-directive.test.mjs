import assert from 'node:assert/strict';
import { test } from 'vitest';
import { HitlResumeDirectiveService } from '../../dist/application/dispatcher/services/hitl/HitlResumeDirectiveService.js';

test('hitl resume directive selects the latest comment when rounds match', () => {
  // Arrange
  const newerComment = {
    body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=3 sha=abc0 waived=none additionalRounds=2 steer=Use the newer direction.',
    createdAt: '2026-10-20T10:02:00Z',
  };
  const olderComment = {
    body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=3 sha=abc0 waived=none additionalRounds=2 steer=Use the older direction.',
    createdAt: '2026-10-20T10:01:00Z',
  };
  const snapshot = { comments: [newerComment, olderComment] };

  // Act
  const directive = HitlResumeDirectiveService.hitlResumeDirective(snapshot, 1, 14);

  // Assert
  assert.equal(directive?.steer, 'Use the newer direction.');
});
