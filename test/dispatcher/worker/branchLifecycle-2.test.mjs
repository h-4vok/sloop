import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  prepareWorkerBranch,
  CliFailure,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('new branch preparation uses main updated by fetch', () => {
  const seed = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-seed-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const work = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-work-'));
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    runGit(seed, ['init', '-b', 'main']);
    runGit(seed, ['config', 'user.email', 'test@example.com']);
    runGit(seed, ['config', 'user.name', 'Test']);
    writeFileSync(join(seed, 'README.md'), 'initial');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'initial']);
    const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    assert.equal(remoteResult.status, 0, remoteResult.stderr);
    runGit(seed, ['remote', 'add', 'origin', remote]);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(work, ['clone', remote, '.']);
    writeFileSync(join(seed, 'README.md'), 'updated main');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'advance main']);
    const updatedMainSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['push', 'origin', 'main']);

    const prepared = prepareWorkerBranch(16, work);

    assert.equal(prepared.branch, 'codex/issue-16');
    assert.equal(prepared.mainBaseSha, updatedMainSha);
    assert.equal(runGit(work, ['rev-parse', 'codex/issue-16']), updatedMainSha);
  } finally {
    rmSync(seed, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}, 30_000);

test('worker branch preparation classifies a failed fetch as an external dependency failure', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-fetch-failure-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.email', 'test@example.com']);
    runGit(['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'README.md'), 'main');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'initial']);
    runGit(['remote', 'add', 'origin', join(root, 'missing-remote')]);

    assert.throws(
      () => prepareWorkerBranch(31, root),
      (error) => error instanceof CliFailure && error.exitCode === 5,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test('dispatcher rejects a PR whose worker branch violates the convention', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 1, title: 'branch validation' }],
    {
      headRefName: 'codex/other-branch',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch codex\/issue-1; found codex\/other-branch/,
  );
});
