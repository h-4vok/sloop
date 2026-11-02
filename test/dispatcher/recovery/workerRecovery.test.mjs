import {
  assert,
  test,
  dispatch,
  pullRequest,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('new issue claim clears the completed issue PR context before validation', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [
      { number: 16, title: 'completed' },
      { number: 17, title: 'next issue', body: 'new acceptance criteria' },
    ],
    {
      headRefName: 'codex/issue-17',

      initialState: {
        issue: 16,

        status: 'ready_for_human_merge',

        pr: 16,

        branch: 'codex/issue-16',

        headSha: 'old-head',

        mainBaseSha: 'old-main',

        reviewRound: 9,

        lastCiFeedback: 'old CI feedback',

        lastQaFeedback: 'old QA feedback',

        lastStaffFeedback: 'old Staff feedback',

        taskContext: 'old task context',

        workerRunId: 'old-run',

        workerPid: 123,

        workerStartedAt: 1,

        workerHeartbeatAt: 1,

        workerRecoveryCount: 4,

        lastError: 'old error',

        completedIssues: [16],

        mainGreen: true,
      },
    },
  );
  const validatedPrs = [];
  const pullRequest = dispatcherHarness.dependencies.pullRequest;
  dispatcherHarness.dependencies.pullRequest = (pr) => {
    validatedPrs.push(pr);
    return pullRequest(pr);
  };

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const claimSave = dispatcherHarness.saves.find((saved) => saved.status === 'claimed');

  assert.deepEqual(claimSave, {
    completedIssues: [16],

    mainGreen: true,

    issue: 17,

    status: 'claimed',

    reviewRound: 1,

    drainStatus: 'running',

    updatedAt: claimSave.updatedAt,
  });
  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #16'), false);
  assert.equal(dispatcherHarness.runs[0].input.includes('old task context'), false);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-17');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(validatedPrs.length > 0, true);
  assert.equal(
    validatedPrs.every((pr) => pr === 14),
    true,
  );
  assert.deepEqual(dispatcherHarness.state().completedIssues, [16, 17]);
  assert.equal(dispatcherHarness.state().mainGreen, true);
});

test('QA changes return to Worker and QA is repeated', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 2, qaCount: 2, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa', 'worker', 'sloop-qa'],
  );
});
