import {
  assert,
  test,
  checkoutWorkerBranch,
  CliFailure,
  dispatch,
  prepareWorkerBranch,
  prepareRecovery,
  createMockDispatcherHarness,
  assertPersistedDiagnostic,
} from '../support/dispatcher-test-support.mjs';

test('new branch preparation failure is persisted and does not leave a claimed run stuck', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fetch failed');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'blocked');
  assert.match(dispatcherHarness.state().lastError, /The loop stopped during blocked/);
  assert.equal(dispatcherHarness.state().lastErrorVerbose, 'fetch failed');
});

test('dispatcher preserves the external exit class from post-preflight branch preparation', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new CliFailure(5, 'git fetch failed: service unavailable');
  };
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 5,
  );

  assert.notEqual(dispatcherHarness.state().status, 'blocked');
});

test('empty diagnostic fallback persists concise blocked context separately from verbose output', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'blocked',
    'No diagnostic output was captured during blocked.',
    [/issue #1/],
  );

  assert.match(dispatcherHarness.state().lastError, /No diagnostic output was available/);
});

test('QA feedback persists concise context and the complete diagnostic', async () => {
  const diagnostic =
    '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n[Q1] fail - café output';
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],

    qaBodies: [diagnostic],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const persisted = dispatcherHarness.saves.find(
    (state) => state.status === 'qa_changes_requested',
  );
  assertPersistedDiagnostic(persisted, 'qa changes requested', diagnostic, [/issue #1/, /PR #14/]);
});

test('recovery failure persists concise issue and PR context with complete diagnostics', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      Date.now(),
      100,
    ),
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {
    throw new Error('recovery checkout failed\nexit 2');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'worker recovery pending',
    'recovery checkout failed\nexit 2',
    [/issue #1/, /PR #14/],
  );
});

test('blocked issue with PR context enters recovery instead of a fresh claim', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'recover me' }], {
    initialState: {
      issue: 1,

      status: 'blocked',

      pr: 14,

      branch: 'codex/issue-1',

      headSha: 'old-head',

      reviewRound: 3,

      lastQaFeedback: 'actionable QA finding',
    },
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fresh claim path must not run');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #14'), true);
  assert.equal(dispatcherHarness.runs[0].input.includes('actionable QA finding'), true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});
