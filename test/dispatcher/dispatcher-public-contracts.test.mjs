import {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  tmpdir,
  join,
  test,
  CliFailure,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  eligible,
  linkIssueToActiveRun,
  pullRequest,
  pullRequestBody,
  recoverStaleLock,
  readState,
  reviewFeedback,
  withIssueClosingReference,
  runCommand,
  hasCommit,
  updatePullRequestBody,
  commentPullRequest,
  writeState,
  maxRoundsForUserBudget,
  selectIssues,
  issueLabelNames,
  createMockGitHubHost,
} from './dispatcher-test-support.mjs';

test('additional rounds mean future rounds from the current round', () => {
  assert.equal(maxRoundsForUserBudget(3, 9, 2), 10);
  assert.equal(maxRoundsForUserBudget(3, 2, 2), 3);
  assert.equal(maxRoundsForUserBudget(3, 9, 6), 14);
  assert.equal(maxRoundsForUserBudget(3, 9, 0), 3);
});

test('shared issue selector orders configured priorities then numeric ties', () => {
  const issues = [
    { number: 20, title: 'unprioritized' },
    { number: 12, title: 'p1', labels: ['Priority: P1'] },
    { number: 8, title: 'p0 later', labels: ['Priority: P0'] },
    { number: 3, title: 'p0 first', labels: ['Priority: P0'] },
  ];

  assert.deepEqual(
    selectIssues(issues, ['Priority: P0', 'Priority: P1']).map(({ number }) => number),
    [3, 8, 12, 20],
  );
});

test('issue label normalization accepts GitHub label objects', () => {
  assert.deepEqual(issueLabelNames([{ name: 'Priority: P0' }, 'Automation Ready']), [
    'Priority: P0',
    'Automation Ready',
  ]);
});

test('public command and commit helpers cover optional and invalid inputs', async () => {
  assert.equal(command(undefined, 1), undefined);
  assert.deepEqual(command(['node', '-e', ''], 1), {
    command: 'node',
    args: ['-e', ''],
    timeoutMs: 120000,
    retries: 0,
    logInvocation: undefined,
  });
  assert.deepEqual(command({ command: 'node', args: [] }, 1), {
    command: 'node',
    args: [],
    timeoutMs: 120000,
    retries: 0,
    logInvocation: undefined,
  });
  assert.throws(() => command({ command: 'node && bad', args: [] }, 1), /shell operators/);
  assert.throws(() => command({ command: 'node', args: ['ok', 1] }, 1), /string array/);
  assert.equal(await runCommand(undefined), '');
  assert.equal(hasCommit(undefined, undefined), true);
  assert.equal(hasCommit(undefined, 'abc'), false);
  assert.equal(hasCommit('not evidence', 'abc'), false);
  assert.equal(hasCommit('commit=abc\n', 'abcdef'), true);
  assert.equal(hasCommit('commit=abcdef', 'abc'), false);
  assert.equal(
    withIssueClosingReference('Closes #2\nBody', 2, [2, 4]),
    'Body\n\nCloses #2\nCloses #4',
  );
  assert.equal(withIssueClosingReference('Body', 2), 'Body\n\nCloses #2');
  assert.equal(withIssueClosingReference('', 7), 'Closes #7');
  assert.throws(() => maxRoundsForUserBudget(-1, 1, 0), /base review-round/);
  assert.throws(() => maxRoundsForUserBudget(1, 0, 0), /current review round/);
  assert.throws(() => maxRoundsForUserBudget(1, 1, -1), /additional review rounds/);
});

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

test('review feedback includes only matching QA review bodies for the requested round', () => {
  assert.equal(
    reviewFeedback(
      {
        number: 7,
        headRefOid: 'abc',
        reviews: [
          { body: '[QA/SDET Review] round=1 verdict=passed', commitId: 'abc' },
          { body: '[QA/SDET Review] round=2 verdict=blocked', commitId: 'abc' },
          { body: '[Staff Review] round=2 verdict=approved', commitId: 'abc' },
        ],
      },
      '[QA/SDET Review]',
      2,
    ),
    '[QA/SDET Review] round=2 verdict=blocked',
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

test('dispatcher state persistence, PID probe, and link operations remain deterministic through injected GitHub host', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-host-'));
  const statePath = join(root, 'state.json');

  assert.deepEqual(readState(statePath), {});
  writeFileSync(statePath, '{bad');
  assert.match(readState(statePath).lastError, /state corruption/);
  writeState({ issue: 1, status: 'claimed' }, statePath);
  assert.equal(readState(statePath).issue, 1);
  assert.throws(
    () => linkIssueToActiveRun(2, statePath, root),
    /one active run with an existing PR/,
  );
  assert.equal(defaultProcessAlive(-1), false);
  assert.equal(defaultProcessAlive(process.pid), true);

  writeState({ issue: 1, pr: 7, status: 'claimed', linkedClosingIssues: [4] }, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({ body: 'Summary', comments: [] });
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({ number: 2, state: 'OPEN', comments: [] });
    return '';
  });
  linkIssueToActiveRun(2, statePath, root, undefined, fake.host);
  assert.deepEqual(readState(statePath).linkedClosingIssues, [4, 2]);
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'edit'),
    true,
  );
  assert.equal(
    fake.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'comment').length,
    2,
  );
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'comment'),
    true,
  );
});
