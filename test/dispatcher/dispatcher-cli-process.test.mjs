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
} from './dispatcher-test-support.mjs';

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

test('review-cap abandonment resumes safely after partial side effects', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-abandon-host-'));
  const statePath = join(root, 'state.json');
  const state = {
    issue: 1,

    pr: 7,

    status: 'review_cap_pending',

    reviewRound: 2,

    reviewCap: {
      capRound: 2,

      outstandingFindingIds: ['Q1'],

      additionalRounds: 0,

      waivedFindingIds: [],
    },
  };
  writeState(state, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: 7, comments: [] });
    return '';
  });
  const abandon = {
    steer: 'stop safely',

    abandon: true,

    waiveAllOutstanding: false,

    waivedFindingIds: [],

    additionalRounds: 0,
  };

  resolveReviewCap(abandon, {}, statePath, root, undefined, fake.host);

  assert.equal(readState(statePath).status, 'abandoned');
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'pr close'),
    true,
  );
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'issue edit'),
    true,
  );
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'issue close'),
    true,
  );

  writeState(
    {
      ...state,

      status: 'abandon_pending',

      abandonment: {
        steer: 'stop safely',

        commentPublished: true,

        prClosed: true,

        labelled: true,

        issueClosed: true,
      },
    },
    statePath,
  );
  const resumed = createMockGitHubHost(() => {
    throw new Error('completed actions must not repeat');
  });
  resolveReviewCap(abandon, {}, statePath, root, undefined, resumed.host);
  assert.equal(readState(statePath).status, 'abandoned');
});

test('Windows batch commands use cmd.exe without Node shell mode', () => {
  assert.deepEqual(
    childProcessInvocation(
      'C:\\tools\\codex.cmd',
      ['exec', '--full-auto'],
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    ),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',

      args: ['/d', '/s', '/v:off', '/c', '""C:\\tools\\codex.cmd" "exec" "--full-auto""'],

      windowsVerbatimArguments: true,
    },
  );
});

test('Windows executable resolution selects an npm command shim', () => {
  assert.equal(
    resolveExecutable('codex', 'win32', () => [
      'C:\\Program Files\\nodejs\\codex',
      'C:\\Program Files\\nodejs\\codex.cmd',
      'C:\\tools\\codex.exe',
    ]),
    'C:\\Program Files\\nodejs\\codex.cmd',
  );
});

test('executable resolution leaves Unix commands and explicit paths unchanged', () => {
  const unexpectedLookup = () => {
    throw new Error('lookup should not run');
  };

  assert.equal(resolveExecutable('codex', 'linux', unexpectedLookup), 'codex');
  assert.equal(
    resolveExecutable('C:\\tools\\codex.exe', 'win32', unexpectedLookup),
    'C:\\tools\\codex.exe',
  );
});

test('Windows batch commands execute from paths containing spaces', (t) => {
  if (process.platform !== 'win32') {
    t.skip('requires Windows cmd.exe');
    return;
  }

  const directory = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop batch command-'));
  const executable = join(directory, 'echo argument.cmd');
  writeFileSync(executable, '@echo off\r\necho %~1\r\n');

  try {
    const launch = childProcessInvocation(executable, ['expected'], 'win32', process.env.ComSpec);
    const result = spawnSync(launch.command, launch.args, {
      encoding: 'utf8',

      shell: false,

      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'expected');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows batch commands reject cmd.exe syntax in argv before launch', () => {
  assert.throws(
    () =>
      childProcessInvocation(
        'C:\\tools\\codex.cmd',
        ['SAFE" & echo INJECTED & rem "'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    /unsafe cmd\.exe syntax/,
  );
});

test('synchronous Windows batch shims preserve verbatim cmd.exe command text', () => {
  let invocation;
  const output = runSyncCommand(
    'C:\\Program Files\\GitHub CLI\\gh.cmd',
    ['pr', 'view', '40'],
    (command, args, options) => {
      invocation = { command, args, options };
      return 'ok';
    },
    'win32',
    'C:\\Windows\\System32\\cmd.exe',
  );

  assert.equal(output, 'ok');
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',

    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      '""C:\\Program Files\\GitHub CLI\\gh.cmd" "pr" "view" "40""',
    ],

    options: {
      cwd: process.cwd(),

      encoding: 'utf8',

      stdio: ['ignore', 'pipe', 'pipe'],

      windowsVerbatimArguments: true,
    },
  });
});

test('non-batch commands preserve their executable and arguments', () => {
  assert.deepEqual(childProcessInvocation('codex', ['exec'], 'win32'), {
    command: 'codex',

    args: ['exec'],
  });
});
