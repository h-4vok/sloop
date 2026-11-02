import assert from 'node:assert/strict';
import { test } from 'vitest';
import { classifyFeedback, classifyWithRetry, collectHumanFeedback } from '../../src/arbiter.js';
import { classifyFeedback as classifyFeedbackResult } from '../../src/arbiter/feedback/classifyFeedback.ts';

test('feedback collection and classification reject unknown or invalid input', () => {
  const feedback = collectHumanFeedback({
    processedIds: ['old'],

    reviews: [
      { id: 'old', body: 'skip' },
      { id: 'r1', state: 'APPROVED', body: 'Looks good' },
      { id: 'r2', body: 'Fix this problem' },
      { body: '  ' },
    ],

    comments: [
      { id: 'c1', body: '[Staff Review] internal' },
      { id: 'c2', body: 'A concern', createdAt: 'now' },
    ],
  });

  assert.deepEqual(feedback.formalApprovals, ['r1']);
  assert.deepEqual(feedback.textualObjections, ['r2', 'c2']);
  assert.equal(feedback.items.length, 3);
  const items = [{ sourceId: 'r1' }];
  assert.throws(() => classifyFeedback(items, {}), /JSON array/);
  const result = classifyFeedback(items, [
    null,
    {},
    { sourceId: 'x', intent: 'approval', confidence: 1 },
    { sourceId: 'r1', intent: 'bad', confidence: 0.5 },
    { sourceId: 'r1', intent: 'approval', confidence: 2 },
    { sourceId: 'r1', intent: 'approval', confidence: 0.5, target: 'x', rationale: 'ok' },
    { sourceId: 'r1', intent: 'concern', confidence: '0' },
  ]);
  assert.deepEqual(result, [
    { sourceId: 'r1', intent: 'approval', confidence: 0.5, target: 'x', rationale: 'ok' },
    { sourceId: 'r1', intent: 'concern', confidence: 0, target: undefined, rationale: undefined },
  ]);
  assert.deepEqual(collectHumanFeedback({}), {
    items: [],

    formalApprovals: [],

    textualObjections: [],
  });
  const generated = collectHumanFeedback({
    reviews: [{ body: 'ok', submittedAt: 't' }],

    comments: [{ body: 'ok', createdAt: 't' }, { body: ' ' }],
  });
  assert.equal(generated.items.length, 2);
});

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
  const classifications = classifyFeedbackResult(feedback.items, [
    { sourceId: 'approval', intent: 'approval', confidence: 1 },
    { sourceId: 'missing', intent: 'concern', confidence: 1 },
    { sourceId: 'concern', intent: 'blocking', confidence: 0.7 },
  ]);
  const invalidOutput = classifyFeedbackResult(feedback.items, '{bad json shape}');

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

test('feedback classification retries invalid output while preserving unresolved items', async () => {
  const preserved = [];
  assert.deepEqual(
    await classifyWithRetry(
      [],
      async () => [],
      () => {},
    ),
    [],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => ['ok'],
      () => {},
    ),
    ['ok'],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => {
        throw new Error('no');
      },
      (items, error) => preserved.push([items, error.message]),
    ),
    [],
  );
  assert.equal(preserved[0][1], 'no');
});
