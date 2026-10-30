import assert from 'node:assert/strict';
import { test } from 'vitest';
import { classifyFeedback } from '../src/arbiter/feedback/classifyFeedback.ts';
import { collectHumanFeedback } from '../src/arbiter/feedback/collectHumanFeedback.ts';

test('feedback collection filters processed and internal comments while classifying known IDs', () => {
  // Arrange
  const observations = {
    processedIds: ['old-review'],
    reviews: [
      { id: 'old-review', body: 'Already handled' },
      { id: 'approval', state: 'APPROVED', body: 'Looks good' },
      { id: 'concern', body: 'Please fix the label' },
    ],
    comments: [
      { id: 'internal', body: '[Staff Review] internal note' },
      { id: 'human-comment', body: 'One concern remains' },
    ],
  };

  // Act
  const feedback = collectHumanFeedback(observations);
  const classifications = classifyFeedback(feedback.items, [
    { sourceId: 'approval', intent: 'approval', confidence: 1 },
    { sourceId: 'missing', intent: 'concern', confidence: 1 },
    { sourceId: 'concern', intent: 'blocking', confidence: 0.7 },
  ]);
  const invalidOutput = classifyFeedback(feedback.items, '{bad json shape}');

  // Assert
  assert.deepEqual(feedback.formalApprovals, ['approval']);
  assert.deepEqual(feedback.textualObjections, ['concern', 'human-comment']);
  assert.deepEqual(
    feedback.items.map((item) => item.sourceId),
    ['approval', 'concern', 'human-comment'],
  );
  assert.deepEqual(
    classifications.value.map((item) => item.sourceId),
    ['approval', 'concern'],
  );
  assert.equal(invalidOutput.ok, false);
});
