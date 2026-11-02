import {
  assert,
  test,
  dispatch,
  pullRequest,
  prepareWorkerBranch,
  createMockGitHubHost,
  createMockDispatcherHarness,
  createQaCommentResponse,
} from '../dispatcher-test-support.mjs';

test('recovery consumes current Worker and QA comments without rerunning agents or creating a branch', async () => {
  // Arrange
  const raw = createQaCommentResponse();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 100, title: 'Unknown keys' }], {
    prNumber: 109,

    headRefName: raw.headRefName,

    initialState: {
      issue: 100,

      pr: 109,

      branch: raw.headRefName,

      headSha: raw.headRefOid,

      workerRunId: 'recovery-run',

      status: 'worker_recovery_pending',

      reviewRound: 2,

      lastError: 'QA evidence missing',

      lastErrorVerbose: 'QA evidence missing',
    },
  });
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  dispatcherHarness.dependencies.pullRequest = () =>
    pullRequest(109, dispatcherHarness.root, 'h-4vok/sloop', fake.host);
  dispatcherHarness.dependencies.run = async () => {
    throw new Error('existing valid evidence must not rerun agents');
  };
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('recovery must not create a branch');
  };
  // Act
  const exit = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(exit, 0);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().pr, 109);
  assert.equal(dispatcherHarness.state().branch, raw.headRefName);
  assert.equal(dispatcherHarness.state().lastQaFeedback, raw.comments[1].body);
  assert.equal(dispatcherHarness.state().lastError, undefined);
  assert.equal(dispatcherHarness.state().lastErrorVerbose, undefined);
});

test('recovery continues to QA when valid Worker evidence exists without a QA comment', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      headSha: 'abc0',

      workerRunId: 'recovery-run',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  const loadPullRequest = dispatcherHarness.dependencies.pullRequest;
  const workerEvidence =
    '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc0\n\n[Human Verification]\n\n1. Open the file.\n2. Confirm its content.';
  dispatcherHarness.dependencies.pullRequest = async (...args) => {
    const evidence = await loadPullRequest(...args);
    return {
      ...evidence,

      comments: [
        { body: workerEvidence, createdAt: '1' },
        ...evidence.comments.filter((comment) => !comment.body?.startsWith('[Worker]')),
      ],
    };
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher still accepts a legacy GitHub QA review', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaPublication: 'review',
  });
  // Act
  const exit = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(exit, 0);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('blocked QA comment requests changes and preserves feedback at the round cap', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['blocked'],

    config: { maxReviewRounds: 1 },
  });
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.ok(dispatcherHarness.saves.some((state) => state.status === 'qa_changes_requested'));
  assert.match(dispatcherHarness.state().lastQaFeedback, /verdict=blocked/);
});
