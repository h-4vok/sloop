import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('reconciles a terminal persisted run before selecting another issue', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'terminal',

    reason: 'PR merged; branch aligned',

    localSha: 'abc1',

    remoteSha: 'abc1',
  });

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().completedIssues.includes(1), true);
  assert.equal(dispatcherHarness.runs[0].env.SLOOP_ISSUE_NUMBER, '2');
  assert.equal(
    dispatcherHarness.saves.filter((state) => state.issue === 1 && state.status === 'done')
      .length >= 1,
    true,
  );
});

test('blocks before selection when terminal reconciliation cannot verify local work', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'blocked',

    reason: 'uncommitted local work remains',
  });

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    /uncommitted local work remains/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
  assert.equal(dispatcherHarness.state().status, 'blocked');
  assert.equal(dispatcherHarness.state().issue, 1);
});

test('repeated terminal reconciliation does not duplicate completed issues', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      status: 'in_progress',

      completedIssues: [1],
    },
  });
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'terminal',

    reason: 'issue closed; branch aligned',
  });

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(dispatcherHarness.state().completedIssues, [1]);
  assert.equal(
    dispatcherHarness.saves.filter((state) => state.issue === 1 && state.status === 'done')
      .length >= 1,
    true,
  );
});

test('open persisted runs keep the existing active-run guard', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'open',

    reason: 'PR remains open',
  });

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    /active run exists for issue #1/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});
