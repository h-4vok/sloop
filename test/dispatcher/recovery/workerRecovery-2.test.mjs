import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  CliFailure,
  command,
  dispatch,
  pullRequest,
  prepareWorkerBranch,
  createMockDispatcherHarness,
  assertPersistedDiagnostic,
} from '../support/dispatcher-test-support.mjs';

test('conflicting Worker PR is rejected before reviews', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.pullRequest = () => ({
    number: 14,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-1',

    headRefOid: 'abc1',

    mergeStateStatus: 'DIRTY',

    mergeable: 'CONFLICTING',

    comments: [{ body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1' }],

    reviews: [],

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /remains conflicting or dirty/);
});

test('failed PR CI returns the issue to a recovered Worker without local npm gates', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(
    dispatcherHarness.runs.some((run) => run.command === 'npm'),
    false,
  );
  const ciFailure = dispatcherHarness.saves.find((state) => state.status === 'ci_failed');
  assertPersistedDiagnostic(ciFailure, 'ci failed', '[CI] pr-checks: FAILURE', [
    /issue #1/,
    /PR #14/,
  ]);
});

test('successful role process without a published review blocks the dispatcher', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    publishEvidence: { qa: false },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /did not publish \[QA\/SDET Review\]/);
});

test('worker branch preparation rejects a dirty checkout before changing branches', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dirty-worktree-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    writeFileSync(join(root, 'untracked.txt'), 'local work');

    assert.throws(
      () => prepareWorkerBranch(12, root),
      (error) =>
        error instanceof CliFailure &&
        error.exitCode === 5 &&
        /working tree is dirty/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher records role command errors as recoverable Worker failures', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => {
    throw new Error('agent command failed');
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /agent command failed/);
});
