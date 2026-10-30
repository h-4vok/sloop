import {
  assert,
  test,
  workerBranchName,
  dispatch,
  checkoutWorkerBranch,
  createMockDispatcherHarness,
  createIsolatedTemporaryDirectory,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  prepareWorkerBranch,
} from '../dispatcher-test-support.mjs';
import { createStaleRemoteWorkerRecovery } from '../support/createStaleRemoteWorkerRecovery.mjs';

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
});

test('stale remote run restores explicit HITL round and existing PR branch before Worker and QA', async () => {
  // Arrange
  const recovery = createStaleRemoteWorkerRecovery();

  // Act
  await dispatch(recovery.dispatcherHarness.cfg, recovery.dispatcherHarness.dependencies);

  // Assert
  const workerInput =
    recovery.dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))
      ?.input ?? '';
  const qaInput =
    recovery.dispatcherHarness.runs.find((run) => run.input?.includes('Use the sloop-qa skill'))
      ?.input ?? '';

  assert.equal(recovery.claimCount(), 0);
  assert.deepEqual(recovery.prepared, []);
  assert.deepEqual(recovery.checkedOut, ['codex/issue-1']);
  assert.match(workerInput, /review round 4/);
  assert.match(workerInput, /Fix Q1 and Q2, then request QA/);
  assert.match(qaInput, /review round 4/);
  assert.equal(recovery.dispatcherHarness.counts().workerCount, 1);
  assert.equal(recovery.dispatcherHarness.counts().qaCount, 1);
  assert.equal(recovery.dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(recovery.dispatcherHarness.state().reviewRound, 4);
  assert.equal(recovery.dispatcherHarness.state().reviewCap.additionalRounds, 2);
  assert.equal(
    recovery.dispatcherHarness.state().reviewCap.steer,
    'Fix Q1 and Q2, then request QA.',
  );
  assert.ok(recovery.published.some((manifest) => manifest.phase === 'blocked'));
});

test('branch mismatch stops before Worker executes', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,

    headRefName: 'codex/issue-1',

    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1-40ae',

      status: 'worker_recovery_pending',

      reviewRound: 2,
    },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  // Act
  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(result, 4);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.match(
    dispatcherHarness.state().lastError,
    /refusing to launch Worker.*must use worker branch codex\/issue-1-40ae; found codex\/issue-1/,
  );
});

test('new branch preparation refuses to overwrite an existing worker branch', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'main');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'initial']);
  const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });

  assert.equal(remoteResult.status, 0, remoteResult.stderr);
  runGit(['remote', 'add', 'origin', remote]);
  runGit(['push', 'origin', 'main']);
  runGit(['branch', 'codex/issue-1']);
  assert.throws(
    () => prepareWorkerBranch(1, root),
    /worker branch codex\/issue-1 already exists; refusing to overwrite it/,
  );
  assert.equal(runGit(['rev-parse', 'codex/issue-1']), runGit(['rev-parse', 'HEAD']));
  rmSync(root, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
}, 15_000);
