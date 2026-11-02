import assert from 'node:assert/strict';
import { test } from 'vitest';
import { classifyFeedback, collectHumanFeedback } from '../src/arbiter.js';

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
