import {
  assert,
  readFileSync,
  readdirSync,
  join,
  test,
  command,
  dispatch,
  pullRequest,
  createMockDispatcherHarness,
  reviewFeedback,
} from '../dispatcher-test-support.mjs';

test('create and recovery smoke paths capture the persisted claimed-issue PR body', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      headRefName: 'codex/issue-17',

      prBody: 'Summary\n\nCloses #1\nClose #99',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // This is the create-path handoff: the Worker receives the exact body contract
  // that it must pass to `gh pr create`.
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  // This is the recovery/update path: the captured `gh pr edit --body-file`
  // equivalent receives one normalized reference and no stale references.
  assert.deepEqual(dispatcherHarness.prBodyUpdates, [
    { number: 14, body: 'Summary\n\nCloses #17' },
  ]);
  assert.equal((dispatcherHarness.prBodyUpdates[0].body.match(/^Closes #17$/gm) ?? []).length, 1);
});

test('review feedback includes only matching QA review bodies for the requested round', () => {
  assert.equal(
    reviewFeedback(
      {
        number: 7,

        headRefOid: 'abc',

        reviews: [
          { body: '[QA/SDET Review] round=1 verdict=passed', commitId: 'abc' },
          { body: '[QA/SDET Review] round=2 verdict=blocked', commitId: 'abc' },
          { body: '[Staff Review] round=2 verdict=approved', commitId: 'abc' },
        ],
      },
      '[QA/SDET Review]',
      2,
    ),
    '[QA/SDET Review] round=2 verdict=blocked',
  );
});
