import {
  assert,
  readFileSync,
  readdirSync,
  join,
  test,
  CliFailure,
  command,
  dispatch,
  pullRequest,
  prepareWorkerBranch,
  prepareRecovery,
  resolveReviewCap,
  reviewFeedback,
  withIssueClosingReference,
  runCommand,
  hasCommit,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockGitHubHost,
  createMockDispatcherHarness,
  createQaCommentResponse,
} from './dispatcher-test-support.mjs';

test('gh response with a current QA comment selects passed instead of old GitHub reviews', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act: use the real gh adapter and the real dispatcher evidence selector.
  const pr = pullRequest(109, '/repo', 'h-4vok/sloop', fake.host);
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, raw.comments[1].body);
  assert.ok(
    fake.calls[0].args.includes('comments,statusCheckRollup') ||
      fake.calls[0].args.some((arg) => arg.includes('reviews,comments')),
  );
  assert.deepEqual(fake.calls[0].args.slice(-2), ['--repo', 'h-4vok/sloop']);
});

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

test('latest matching QA publication wins across comments and legacy reviews regardless of array order', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const older = {
    body: `[QA/SDET Review] round=2 verdict=blocked commit=${raw.headRefOid}`,

    createdAt: '2026-10-01T08:48:00Z',
  };
  const newest = {
    body: '[QA/SDET Review] round=2 verdict=changes_requested',

    commit: { oid: raw.headRefOid },

    submittedAt: '2026-10-01T08:49:00Z',
  };
  raw.comments.push(older);
  raw.reviews.unshift(newest);
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, newest.body);
});

test('legacy QA review with contradictory native and declared SHAs is rejected', () => {
  // Arrange
  const pr = {
    headRefOid: 'abc123',

    reviews: [{ body: '[QA/SDET Review] round=2 verdict=passed commit=stale', commitId: 'abc123' }],
  };
  // Act
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, '');
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

test('QA comment is accepted when GitHub has no Pull Request Review objects', () => {
  // Arrange
  const raw = createQaCommentResponse();
  delete raw.reviews;
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, raw.comments[1].body);
});

test('dispatcher rejects a QA comment for another SHA even when QA exits successfully', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaBodies: ['[QA/SDET Review] round=1 verdict=passed commit=stale'],

    config: { evidenceTimeoutMs: 1, evidencePollIntervalMs: 1 },
  });
  let clock = 0;
  dispatcherHarness.dependencies.now = () => clock;
  dispatcherHarness.dependencies.sleep = async () => {
    clock += 1;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /round=1 commit=abc1/);
  assert.match(dispatcherHarness.state().lastError, /checked PR comments and GitHub reviews/);
});

test('dispatcher reconciles a PR when the Worker omits its result marker', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill')
      ? 'Done. PR [#14](https://github.com/example/repo/pull/14) targets main.'
      : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(
    dispatcherHarness.runs.map(({ input }) => input.includes('Use the sloop-qa skill')),
    [false, true],
  );
});

test('dispatcher rejects an unrelated summary PR before changing its body', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    headRefName: 'codex/unrelated',
  });
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill') ? 'Done. PR #14 targets main.' : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.prBodyUpdates.length, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /must use worker branch/);
});

test('HEAD changing during QA prevents acceptance of its passed comment', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const originalRun = dispatcherHarness.dependencies.run;
  const originalPullRequest = dispatcherHarness.dependencies.pullRequest;
  let hasQaFinished = false;
  dispatcherHarness.dependencies.run = async (spec) => {
    const result = await originalRun(spec);
    if (spec.input?.includes('Use the sloop-qa skill')) hasQaFinished = true;
    return result;
  };
  dispatcherHarness.dependencies.pullRequest = async (...args) => {
    const pr = await originalPullRequest(...args);
    return hasQaFinished ? { ...pr, headRefOid: 'another-head' } : pr;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /HEAD changed/);
});

test('post-preflight external adapter failures preserve exit 5', async () => {
  const dispatcherHarness = createMockDispatcherHarness([
    { number: 1, title: 'one', body: 'acceptance criteria' },
  ]);
  dispatcherHarness.dependencies.comment = () => {
    throw new CliFailure(5, 'gh issue comment failed: service unavailable');
  };

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 5,
  );

  assert.equal(dispatcherHarness.state().status, 'claimed');
});

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

test('public CLI commands invoke only the injected control seams', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: { issue: 28, pr: 49, status: 'blocked' },
  });
  const calls = [];
  dispatcherHarness.dependencies.loadConfig = () => (
    calls.push(['loadConfig']),
    dispatcherHarness.cfg
  );
  dispatcherHarness.dependencies.status = (verbose) => (
    calls.push(['status', verbose]),
    { status: 'injected' }
  );
  dispatcherHarness.dependencies.list = () => (
    calls.push(['list']),
    [{ number: 28, title: 'injected' }]
  );
  dispatcherHarness.dependencies.recoverLock = () => (
    calls.push(['recoverLock']),
    'injected recovery'
  );
  dispatcherHarness.dependencies.reset = () => calls.push(['reset']);
  dispatcherHarness.dependencies.resolveReviewCap = (args, config) =>
    calls.push(['resolveReviewCap', args, config]);
  dispatcherHarness.dependencies.linkIssue = (issue) => calls.push(['linkIssue', issue]);
  dispatcherHarness.dependencies.prepareRecovery = (issue, pr, config) => (
    calls.push(['prepareRecovery', issue, pr, config]),
    49
  );
  const originalLog = console.log;
  console.log = () => {};
  try {
    const dispatcherArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, dispatcherHarness.dependencies);
    const dispatcherArgs2 = ['--list'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, dispatcherHarness.dependencies);
    const dispatcherArgs3 = ['--recover-lock'];
    const parsedDispatcherCommand3 = parseDispatcherCommand(dispatcherArgs3);
    await runDispatcherCli(parsedDispatcherCommand3, dispatcherHarness.dependencies);
    const dispatcherArgs4 = ['--reset'];
    const parsedDispatcherCommand4 = parseDispatcherCommand(dispatcherArgs4);
    await runDispatcherCli(parsedDispatcherCommand4, dispatcherHarness.dependencies);
    const dispatcherArgs5 = [
      '--resolve-review-cap',
      '--steer',
      'continue',
      '--additional-rounds',
      '1',
    ];
    const parsedDispatcherCommand5 = parseDispatcherCommand(dispatcherArgs5);
    await runDispatcherCli(parsedDispatcherCommand5, dispatcherHarness.dependencies);
    const dispatcherArgs6 = ['--link-issue', '29'];
    const parsedDispatcherCommand6 = parseDispatcherCommand(dispatcherArgs6);
    await runDispatcherCli(parsedDispatcherCommand6, dispatcherHarness.dependencies);
    const dispatcherArgs7 = ['--prepare-recovery', '28', '--pr', '49'];
    const parsedDispatcherCommand7 = parseDispatcherCommand(dispatcherArgs7);
    await runDispatcherCli(parsedDispatcherCommand7, dispatcherHarness.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      'status',
      'list',
      'recoverLock',
      'reset',
      'loadConfig',
      'resolveReviewCap',
      'linkIssue',
      'loadConfig',
      'prepareRecovery',
    ],
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'status'),
    ['status', true],
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'linkIssue'),
    ['linkIssue', 29],
  );
  assert.deepEqual(calls.find(([name]) => name === 'prepareRecovery').slice(0, 3), [
    'prepareRecovery',
    28,
    49,
  ]);
});

test('commands use argv, exit codes, retries, timeout and no shell contract', async () => {
  assert.deepEqual(command(['node', '-e', 'process.exit(0)'], 42, true).args, [
    '-e',
    'process.exit(0)',
  ]);
  assert.throws(() => command({ command: 'node; malicious' }, 1), /shell operators/);
  assert.throws(
    () => command({ command: 'codex' }, 1),
    /args as a string array; migrate each role command/,
  );
  assert.throws(
    () => command({ command: 'codex', args: ['exec', 1] }, 1),
    /args as a string array; migrate each role command/,
  );
  await assert.rejects(
    runCommand(command({ command: 'node', args: ['-e', 'process.exit(2)'], retries: 1 }, 0)),
    /failed after 2 attempt/,
  );
  await assert.rejects(
    () =>
      runCommand(
        command({ command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'], timeoutMs: 10 }, 0),
      ),
    /failed/,
  );
});

test('role commands preserve distinct argv and logging configuration', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 1, title: 'one', body: 'criteria' }],
    {
      config: {
        workerCommand: {
          command: 'worker-codex',

          args: ['exec', '--sandbox', 'read-only', '--worker'],
        },

        qaCommand: { command: 'qa-codex', args: ['exec', '--sandbox', 'workspace-write', '--qa'] },
      },
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(
    dispatcherHarness.runs.map(({ command, args, logInvocation }) => ({
      command,

      args,

      logInvocation,
    })),
    [
      {
        command: 'worker-codex',

        args: ['exec', '--sandbox', 'read-only', '--worker'],

        logInvocation: true,
      },
      {
        command: 'qa-codex',

        args: ['exec', '--sandbox', 'workspace-write', '--qa'],

        logInvocation: true,
      },
    ],
  );
});

test('invalid role commands fail before any process launch with migration guidance', async () => {
  for (const invalid of [
    { command: 'codex', args: ['exec'] },
    { command: 'C:\\tools\\codex.exe', args: ['exec'] },
    { command: 'codex', args: ['exec', '--sandbox', 'read-only', '--sandbox', 'read-only'] },
    { command: 'codex', args: ['exec', '--sandbox', 'invalid'] },
  ]) {
    const dispatcherHarness = createMockDispatcherHarness(undefined, {
      config: { workerCommand: invalid },
    });
    await assert.rejects(
      () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
      /exactly one valid --sandbox/,
    );
    assert.equal(dispatcherHarness.runs.length, 0);
  }
  const legacy = createMockDispatcherHarness(undefined, { config: { codexSandbox: 'read-only' } });
  await assert.rejects(
    () => dispatch(legacy.cfg, legacy.dependencies),
    /codexSandbox is no longer supported/,
  );
  assert.equal(legacy.runs.length, 0);
});

test('logRoleInvocation false suppresses role invocation logging metadata', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, {
    config: { logRoleInvocation: false },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.logInvocation),
    [false, false],
  );
});

test('failed commands preserve complete multiline stdout and stderr diagnostics', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',

            args: [
              '-e',
              "process.stdout.write('worker stdout one\\nworker stdout two\\n'); process.stderr.write('worker stderr one\\nworker stderr two\\n'); process.exit(17)",
            ],
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /exit 17/);
      assert.match(error.message, /stdout:\nworker stdout one\nworker stdout two\n/);
      assert.match(error.message, /stderr:\nworker stderr one\nworker stderr two\n/);
      return true;
    },
  );
});

test('failed retries retain diagnostics from every unsuccessful attempt', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',

            args: [
              '-e',
              "process.stdout.write('retry stdout\\n'); process.stderr.write('retry stderr\\n'); process.exit(17)",
            ],

            retries: 1,
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /failed after 2 attempt\(s\)/);
      assert.match(error.message, /attempt 1: exit 17/);
      assert.match(error.message, /attempt 2: exit 17/);
      assert.equal((error.message.match(/retry stdout/g) ?? []).length, 2);
      assert.equal((error.message.match(/retry stderr/g) ?? []).length, 2);
      return true;
    },
  );
});

test('PR closing reference uses the claimed issue exactly once for creation and recovery', () => {
  assert.equal(withIssueClosingReference('Summary', 17), 'Summary\n\nCloses #17');
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nclosed #99', 17),
    'Summary\n\nCloses #17',
  );
  assert.throws(() => withIssueClosingReference('', 0), /issue number must be positive/);
});

test('Worker commit evidence accepts escaped newline delimiters from Windows comments', () => {
  assert.equal(hasCommit('[Worker] round=2 commit=abc123\\n\\nVerification', 'abc123456789'), true);
  assert.equal(hasCommit('[Worker] round=2 commit=abc123', 'def456789'), false);
});

test('dispatcher runs Worker and QA and uses Markdown PR evidence', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa'],
  );
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.args.slice(-2)),
    [
      ['--sandbox', 'read-only'],
      ['--sandbox', 'read-only'],
    ],
  );
  assert.equal(dispatcherHarness.runs[0].env.SLOOP_ISSUE_NUMBER, '1');
  assert.match(dispatcherHarness.runs[0].input, /exactly one \[Worker\] evidence comment/);
  assert.match(
    dispatcherHarness.runs[0].input,
    /repository's own AGENTS\.md, scripts, and workflow instructions/,
  );
  assert.doesNotMatch(dispatcherHarness.runs[0].input, /npm run pr-checks|canonical gate/);
  const published = await dispatcherHarness.dependencies.pullRequest(14);
  assert.equal(
    published.comments.filter((comment) => comment.body.startsWith('[QA/SDET Review]')).length,
    1,
  );
  assert.equal(dispatcherHarness.reviews.length, 0);
  assert.match(dispatcherHarness.runs[1].input, /gh pr comment --body-file/);
  const guide =
    dispatcherHarness.comments.find(([, body]) => body.startsWith('[Human Review Guide]'))?.[1] ??
    '';
  assert.match(guide, /commit=abc1/);
  assert.match(guide, /Run the focused command/);
  assert.match(guide, /documented output appears/);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().mainBaseSha, 'main-sha-1');
  const runDirectories = readdirSync(join(dispatcherHarness.root, '.sloop', 'runs'));
  const events = runDirectories.flatMap((directory) =>
    readFileSync(join(dispatcherHarness.root, '.sloop', 'runs', directory, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  assert.ok(events.some((event) => event.type === 'context'));
  assert.ok(events.some((event) => event.type === 'transition'));
  assert.ok(events.some((event) => event.type === 'prompt'));
  assert.ok(events.some((event) => event.type === 'result'));
  assert.ok(events.some((event) => event.type === 'stdout'));
  assert.ok(events.some((event) => event.type === 'stderr'));
  assert.ok(events.some((event) => event.type === 'codex'));
  assert.ok(events.every((event) => Number.isInteger(event.seq)));
});

test('existing human guide for the current commit is not published twice', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 1 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('duplicate human guides for the current commit block ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 2 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /Expected exactly one \[Human Review Guide\].*duplicates/,
  );
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('malformed current human guide blocks ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { malformedHumanGuide: true });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /not dispatcher-rendered/);
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('incomplete Worker human-verification evidence blocks before ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { humanVerification: false });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /complete \[Human Verification\] guide/);
});

test('create and recovery smoke paths capture the persisted claimed-issue PR body', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      headRefName: 'codex/issue-17',

      prBody: 'Summary\n\nCloses #1\nClose #99',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // This is the create-path handoff: the Worker receives the exact body contract
  // that it must pass to `gh pr create`.
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  // This is the recovery/update path: the captured `gh pr edit --body-file`
  // equivalent receives one normalized reference and no stale references.
  assert.deepEqual(dispatcherHarness.prBodyUpdates, [
    { number: 14, body: 'Summary\n\nCloses #17' },
  ]);
  assert.equal((dispatcherHarness.prBodyUpdates[0].body.match(/^Closes #17$/gm) ?? []).length, 1);
});

test('dispatcher-generated body is used by the initial PR creation path', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      workerCreatesPr: true,
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  assert.equal(dispatcherHarness.runs[0].env.SLOOP_PR_BODY, 'Closes #17');
  assert.deepEqual(dispatcherHarness.createdPrBodies, ['Closes #17']);
  assert.equal((dispatcherHarness.createdPrBodies[0].match(/^Closes #17$/gm) ?? []).length, 1);
});
