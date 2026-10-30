import {
  assert,
  test,
  pullRequest,
  reviewFeedback,
  createMockGitHubHost,
  createQaCommentResponse,
  dispatch,
  createMockDispatcherHarness,
  hasCommit,
} from '../dispatcher-test-support.mjs';

test('gh response with a current QA comment selects passed instead of old GitHub reviews', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act: use the real gh adapter and the real dispatcher evidence selector.
  const pr = pullRequest(109, '/repo', 'h-4vok/sloop', fake.host);
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, raw.comments[1].body);
  assert.ok(
    fake.calls[0].args.includes('comments,statusCheckRollup') ||
      fake.calls[0].args.some((arg) => arg.includes('reviews,comments')),
  );
  assert.deepEqual(fake.calls[0].args.slice(-2), ['--repo', 'h-4vok/sloop']);
});

test('latest matching QA publication wins across comments and legacy reviews regardless of array order', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const older = {
    body: `[QA/SDET Review] round=2 verdict=blocked commit=${raw.headRefOid}`,

    createdAt: '2026-10-01T08:48:00Z',
  };
  const newest = {
    body: '[QA/SDET Review] round=2 verdict=changes_requested',

    commit: { oid: raw.headRefOid },

    submittedAt: '2026-10-01T08:49:00Z',
  };
  raw.comments.push(older);
  raw.reviews.unshift(newest);
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, newest.body);
});

test('legacy QA review with contradictory native and declared SHAs is rejected', () => {
  // Arrange
  const pr = {
    headRefOid: 'abc123',

    reviews: [{ body: '[QA/SDET Review] round=2 verdict=passed commit=stale', commitId: 'abc123' }],
  };
  // Act
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, '');
});

test('dispatcher rejects a QA comment for another SHA even when QA exits successfully', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaBodies: ['[QA/SDET Review] round=1 verdict=passed commit=stale'],

    config: { evidenceTimeoutMs: 1, evidencePollIntervalMs: 1 },
  });
  let clock = 0;
  dispatcherHarness.dependencies.now = () => clock;
  dispatcherHarness.dependencies.sleep = async () => {
    clock += 1;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /round=1 commit=abc1/);
  assert.match(dispatcherHarness.state().lastError, /checked PR comments and GitHub reviews/);
});

test('HEAD changing during QA prevents acceptance of its passed comment', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const originalRun = dispatcherHarness.dependencies.run;
  const originalPullRequest = dispatcherHarness.dependencies.pullRequest;
  let hasQaFinished = false;
  dispatcherHarness.dependencies.run = async (spec) => {
    const result = await originalRun(spec);
    if (spec.input?.includes('Use the sloop-qa skill')) hasQaFinished = true;
    return result;
  };
  dispatcherHarness.dependencies.pullRequest = async (...args) => {
    const pr = await originalPullRequest(...args);
    return hasQaFinished ? { ...pr, headRefOid: 'another-head' } : pr;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /HEAD changed/);
});

test('Worker commit evidence accepts escaped newline delimiters from Windows comments', () => {
  assert.equal(hasCommit('[Worker] round=2 commit=abc123\\n\\nVerification', 'abc123456789'), true);
  assert.equal(hasCommit('[Worker] round=2 commit=abc123', 'def456789'), false);
});
