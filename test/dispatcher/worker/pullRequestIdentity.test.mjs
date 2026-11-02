import {
  assert,
  test,
  withIssueClosingReference,
  dispatch,
  createMockDispatcherHarness,
  eligible,
  pullRequest,
  reviewFeedback,
  createMockGitHubHost,
  createQaCommentResponse,
} from '../dispatcher-test-support.mjs';

test('PR closing references preserve authorized linked issues and remove stale ones', () => {
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nClosed #99', 17, [39]),
    'Summary\n\nCloses #17\nCloses #39',
  );
});

test('dispatcher rejects a configurable non-main PR base explicitly', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await assert.rejects(
    () =>
      dispatch({ ...dispatcherHarness.cfg, baseBranch: 'develop' }, dispatcherHarness.dependencies),
    /Worker PR baseBranch must be main; found develop/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('Worker revalidates the PR base if configuration changes during dispatch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const config = { ...dispatcherHarness.cfg, baseBranch: 'main' };
  dispatcherHarness.dependencies.eligible = () => {
    config.baseBranch = 'develop';
    return [{ number: 1, title: 'one' }];
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(config, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /baseBranch must be main; found develop/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('QA comment is accepted when GitHub has no Pull Request Review objects', () => {
  // Arrange
  const raw = createQaCommentResponse();
  delete raw.reviews;
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, raw.comments[1].body);
});

test('dispatcher rejects an unrelated summary PR before changing its body', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    headRefName: 'codex/unrelated',
  });
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill') ? 'Done. PR #14 targets main.' : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.prBodyUpdates.length, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /must use worker branch/);
});

test('PR closing reference uses the claimed issue exactly once for creation and recovery', () => {
  assert.equal(withIssueClosingReference('Summary', 17), 'Summary\n\nCloses #17');
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nclosed #99', 17),
    'Summary\n\nCloses #17',
  );
  assert.throws(() => withIssueClosingReference('', 0), /issue number must be positive/);
});
