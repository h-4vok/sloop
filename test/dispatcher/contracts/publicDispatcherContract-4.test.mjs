import {
  createIsolatedTemporaryDirectory,
  assert,
  mkdirSync,
  writeFileSync,
  tmpdir,
  join,
  test,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  recoverStaleLock,
  runCommand,
  eligible,
  pullRequest,
  pullRequestBody,
  createMockGitHubHost,
  existsSync,
  readFileSync,
  CliFailure,
  updatePullRequestBody,
  commentPullRequest,
} from '../dispatcher-test-support.mjs';

test('remaining public failure boundaries are deterministic', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-boundaries-'));

  assert.equal(recoverStaleLock(root), 'No dispatcher lock found.');
  mkdirSync(dispatcherLockPath(root), { recursive: true });
  writeFileSync(join(dispatcherLockPath(root), 'owner.json'), 'not-json');
  assert.throws(() => recoverStaleLock(root), /owner is invalid/);
  assert.equal(defaultProcessAlive(2147483647), false);
  await assert.rejects(
    runCommand(
      command(
        { command: 'sloop-definitely-missing-executable-coverage', args: [], timeoutMs: 100 },
        1,
      ),
      root,
    ),
    /failed/,
  );
});

test('native dispatcher GitHub operations preserve argv, repository scoping, and response normalization', () => {
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([
        { number: 9, title: 'later' },
        { number: 2, title: 'first' },
      ]);
    if (args[0] === 'pr' && args[1] === 'view' && args.some((arg) => arg.includes('number,state')))
      return JSON.stringify({
        number: 7,

        body: undefined,

        merge_state_status: 'CLEAN',

        reviews: [{ body: 'review', submitted_at: 'two', commit: { oid: 'abc' } }],

        comments: [{ body: 'comment', created_at: 'one' }],

        statusCheckRollup: [{ context: 'pr-checks', state: 'SUCCESS', details_url: 'https://x' }],
      });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({});
    return '';
  });

  // Arrange / Act / Assert: each operation receives only the adapter host.
  assert.deepEqual(
    eligible('/repo', 'owner/repo', 'ready', fake.host).map(({ number }) => number),
    [2, 9],
  );
  const normalized = pullRequest(7, '/repo', 'owner/repo', fake.host);
  assert.equal(normalized.number, 7);
  assert.equal(normalized.body, '');
  assert.equal(normalized.mergeStateStatus, 'CLEAN');
  assert.deepEqual(normalized.reviews, [
    { body: 'review', state: undefined, submittedAt: 'two', commitId: 'abc' },
  ]);
  assert.deepEqual(normalized.comments, [{ body: 'comment', createdAt: 'one' }]);
  assert.deepEqual(normalized.statusCheckRollup, [
    { name: 'pr-checks', status: 'SUCCESS', conclusion: 'SUCCESS', detailsUrl: 'https://x' },
  ]);
  assert.equal(pullRequestBody(7, '/repo', 'owner/repo', fake.host), '');
  assert.equal(
    fake.calls.every(({ args }) => args.slice(-2).join(' ') === '--repo owner/repo'),
    true,
  );
});

test('native dispatcher GitHub writes redact bodies, clean temporary files, and classify execution failures', () => {
  let bodyFile;
  const fake = createMockGitHubHost((args) => {
    if (args.includes('--body-file')) {
      bodyFile = args.at(-1);
      assert.equal(readFileSync(bodyFile, 'utf8'), 'safe body');
    }
    return '';
  });

  updatePullRequestBody(7, 'safe body', '/repo', undefined, fake.host);
  commentPullRequest(7, 'safe body', '/repo', undefined, fake.host);

  assert.equal(existsSync(bodyFile), false);
  assert.deepEqual(
    fake.calls.map(({ args }) => args.slice(0, 3)),
    [
      ['pr', 'edit', '7'],
      ['pr', 'comment', '7'],
    ],
  );
  assert.throws(
    () => commentPullRequest(7, { invalid: true }, '/repo', undefined, fake.host),
    TypeError,
  );

  const failing = createMockGitHubHost(() => {
    throw new Error('offline');
  });
  assert.throws(
    () => eligible('/repo', undefined, 'ready', failing.host),
    (error) => error instanceof CliFailure && error.exitCode === 5 && /offline/.test(error.message),
  );
  const invalidJson = createMockGitHubHost(() => '{broken');
  assert.throws(
    () => pullRequestBody(7, '/repo', undefined, invalidJson.host),
    /gh returned invalid JSON/,
  );
});
