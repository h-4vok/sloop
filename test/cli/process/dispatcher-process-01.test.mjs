import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  childProcessInvocation,
  checkoutWorkerBranch,
  command,
  dispatch,
  eligible,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  readState,
  runDispatcherCli,
  writeState,
  createMockGitHubHost,
  createMockDispatcherHarness,
} from '../../dispatcher/dispatcher-test-support.mjs';

test('dispatcher rejects unsupported production configuration before starting a run', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        { ...dispatcherHarness.cfg, codexSandbox: 'read-only' },
        dispatcherHarness.dependencies,
      ),
    /codexSandbox is no longer supported/,
  );
  await assert.rejects(
    () =>
      dispatch({ ...dispatcherHarness.cfg, baseBranch: 'develop' }, dispatcherHarness.dependencies),
    /baseBranch must be main/,
  );
  await assert.rejects(
    () =>
      dispatch(dispatcherHarness.cfg, {
        ...dispatcherHarness.dependencies,

        remoteRequired: true,

        remote: undefined,
      }),
    /remote authority is required/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher reports missing required role commands after acquiring its lock', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        { ...dispatcherHarness.cfg, workerCommand: undefined },
        dispatcherHarness.dependencies,
      ),
    /workerCommand and qaCommand are required/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher requires a valid Codex sandbox on role commands', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        {
          ...dispatcherHarness.cfg,

          workerCommand: { command: 'codex', args: ['exec'] },
        },
        dispatcherHarness.dependencies,
      ),
    /exactly one valid --sandbox/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher rejects legacy argv arrays for role commands', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        {
          ...dispatcherHarness.cfg,

          workerCommand: ['codex', 'exec'],
        },
        dispatcherHarness.dependencies,
      ),
    /role commands must be/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('workflow command delegates to dispatch and completes when no issue is eligible', async () => {
  const dispatcherHarness = createMockDispatcherHarness([]);
  dispatcherHarness.dependencies.eligible = () => [];

  const result = await runDispatcherCli({ kind: 'workflow' }, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'done');
  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher CLI worktree controls and checkout retain their direct contracts', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.listAllWorktrees = () => ['one'];
  dispatcherHarness.dependencies.clearAllWorktrees = () => calls.push('clear');
  await runDispatcherCli({ kind: 'list-all-worktrees' }, dispatcherHarness.dependencies);
  await runDispatcherCli({ kind: 'clear-all-worktrees' }, dispatcherHarness.dependencies);

  assert.deepEqual(calls, ['clear']);

  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-checkout-'));
  const runGitCommand = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  runGitCommand(['init', '--initial-branch=main']);
  runGitCommand(['config', 'user.email', 'test@example.test']);
  runGitCommand(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'one');
  runGitCommand(['add', '.']);
  runGitCommand(['commit', '-m', 'initial']);
  runGitCommand(['branch', 'worker']);
  checkoutWorkerBranch('worker', root);
  const current = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  assert.equal(current.stdout.trim(), 'worker');
});
