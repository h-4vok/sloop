import {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  acquire,
  command,
  dispatcherLockPath,
  dispatch,
  eligible,
  prepareRecovery,
  recoverStaleLock,
  redactDiagnostic,
  resetRunState,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockDispatcherHarness,
} from './dispatcher-test-support.mjs';

test('status returns only the concise summary by default', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      pr: 42,
      status: 'worker_running',
      lastError: 'short summary',
      lastErrorVerbose: 'line one\nUnicode: café\nline three',
      branch: 'codex/issue-9',
      workerRecoveryCount: 3,
    },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);

    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  const expectedStatus = {
    issue: 9,
    pr: 42,
    status: 'worker_running',
    lastError: 'short summary',
  };

  assert.deepEqual(JSON.parse(output[0]), expectedStatus);
});

test('verbose status returns the complete diagnostic state', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      pr: 42,
      status: 'worker_running',
      lastError: 'short summary',
      lastErrorVerbose: 'line one\nUnicode: café\nline three',
      branch: 'codex/issue-9',
      workerRecoveryCount: 3,
    },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const verboseStatusArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(verboseStatusArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  const verboseStatus = JSON.parse(output[0]);

  assert.deepEqual(verboseStatus, injected.state());
});

test('status recommends safe recovery only for valid pending Worker context', async () => {
  const cases = [
    {
      state: { issue: 31, pr: 54, status: 'worker_recovery_pending' },
      expected: {
        issue: 31,
        pr: 54,
        status: 'worker_recovery_pending',
        nextAction: {
          command: 'sloop --prepare-recovery 31 --pr 54',
          description: 'Prepare local recovery for the failed Worker.',
          mutates: true,
        },
      },
    },
    {
      state: { issue: 31, pr: 54, status: 'worker_running' },
      expected: { issue: 31, pr: 54, status: 'worker_running' },
    },
    {
      state: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
      expected: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
      expected: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
      expected: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: 31, status: 'worker_recovery_pending' },
      expected: { issue: 31, status: 'worker_recovery_pending' },
    },
  ];

  for (const { state, expected } of cases) {
    const injected = createMockDispatcherHarness([], { initialState: state });
    let output;
    const originalLog = console.log;
    console.log = (value) => (output = value);
    try {
      const dispatcherArgs = ['--status'];
      const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
      await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(JSON.parse(output), expected);
    assert.deepEqual(injected.state(), state);
  }
});

test('status rejects unsupported flag combinations', () => {
  const dispatcherHarness = createMockDispatcherHarness();

  for (const args of [
    ['--status', '--list'],
    ['--status', '--verbose', '--list'],
    ['--status', '--unknown'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), ...args],
      { cwd: dispatcherHarness.root, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /mixed, duplicate, unknown, or unsupported|no longer supported; use `sloop status`/,
    );
    assert.equal(result.stdout, '');
  }
});

test('--list prints only issue number and title while eligible issues retain body data', async () => {
  const injectedIssues = [
    { number: 7, title: 'Earlier issue', body: 'other internal context' },
    { number: 25, title: 'Structured agent output', body: 'internal acceptance criteria' },
  ];
  const injected = createMockDispatcherHarness(injectedIssues);
  let output;
  const originalLog = console.log;
  console.log = (value) => (output = value);
  try {
    const dispatcherArgs = ['--list'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    JSON.parse(output),
    injectedIssues.map(({ number, title }) => ({ number, title })),
  );
  assert.doesNotMatch(output, /body|internal acceptance criteria|other internal context/);
  assert.deepEqual(injected.dependencies.eligible(), injectedIssues);
});

test('diagnostic redaction preserves safe multiline output and hides common credentials', () => {
  const output = redactDiagnostic(
    'exit 1\nGITHUB_TOKEN=secret-value\n{"password":"p@ss"}\nhttps://example.test/log',
  );

  assert.match(output, /exit 1/);
  assert.match(output, /https:\/\/example.test\/log/);
  assert.doesNotMatch(output, /secret-value|p@ss/);
  assert.match(output, /\[REDACTED\]/);
});

test('diagnostic redaction exactly preserves hyphenated credential-key assignments', () => {
  const diagnostic = [
    'X-Secret-Value: secret-123',
    'X-Credentials-Blob=credentials-123',
    'X-Password-Hint: password-123',
  ].join('\n');
  const expected = [
    'X-Secret-Value: [REDACTED]',
    'X-Credentials-Blob=[REDACTED]',
    'X-Password-Hint: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction exactly preserves bare and prefixed header diagnostics', () => {
  const diagnostic = [
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'Proxy-Authorization: Bearer proxy-secret',
    'Cookie: session=one; csrf=two',
    'Set-Cookie: session=three; HttpOnly',
    '> Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'curl: Proxy-Authorization: Basic cHJveHk6c2VjcmV0',
    'request headers: Cookie: session=one; csrf=two',
    'trace: Set-Cookie: session=three; HttpOnly',
  ].join('\n');
  const expected = [
    'Authorization: [REDACTED]',
    'Proxy-Authorization: [REDACTED]',
    'Cookie: [REDACTED]',
    'Set-Cookie: [REDACTED]',
    '> Authorization: [REDACTED]',
    'curl: Proxy-Authorization: [REDACTED]',
    'request headers: Cookie: [REDACTED]',
    'trace: Set-Cookie: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction removes short Bearer credentials', () => {
  const output = redactDiagnostic('Bearer abc\nBearer secret\nBearer a');

  assert.equal(output, 'Bearer [REDACTED]\nBearer [REDACTED]\nBearer [REDACTED]');
});

test('diagnostic redaction removes URL userinfo and complete cookie header values', () => {
  const output = redactDiagnostic(
    'https://alice:supersecret@example.test/log\nCookie: session=one; csrf=two\nSet-Cookie: session=three; HttpOnly\nhttps://example.test/safe',
  );

  assert.match(output, /https:\/\/\[REDACTED\]@example\.test\/log/);
  assert.match(output, /Cookie: \[REDACTED\]/);
  assert.match(output, /Set-Cookie: \[REDACTED\]/);
  assert.match(output, /https:\/\/example\.test\/safe/);
  assert.doesNotMatch(output, /alice|supersecret|session=one|csrf=two|session=three/);
});

test('legacy lastError-only state remains readable in both status modes', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: { issue: 9, status: 'blocked', lastError: 'legacy failure summary' },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);
  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    const dispatcherArgs2 = ['--status', '--verbose'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  for (const value of output)
    assert.deepEqual(JSON.parse(value), {
      issue: 9,
      status: 'blocked',
      lastError: 'legacy failure summary',
    });
});

test('successful state without errors remains unchanged in both status modes', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: { issue: 9, status: 'claimed' },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);
  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    const dispatcherArgs2 = ['--status', '--verbose'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  for (const value of output) assert.deepEqual(JSON.parse(value), { issue: 9, status: 'claimed' });
});

test('verbose status preserves quotes and shell-like diagnostic text exactly', async () => {
  const injectedDiagnostic = 'stdout: "quoted"\nstderr: $(whoami) & echo %PATH%\nexit=17';
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      status: 'blocked',
      lastError: 'short summary',
      lastErrorVerbose: injectedDiagnostic,
    },
  });
  let output;
  const originalLog = console.log;
  console.log = (value) => (output = value);
  try {
    const dispatcherArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.equal(JSON.parse(output).lastErrorVerbose, injectedDiagnostic);
});

test('prepareRecovery preserves PR and removes only the issue from completion', () => {
  const state = prepareRecovery(
    {
      pr: 15,
      headSha: 'head-15',
      mainBaseSha: 'main-10',
      reviewRound: 4,
      lastQaFeedback: 'fix the boundary case',
      taskContext: 'recovered task context',
      completedIssues: [1, 2],
      status: 'done',
    },
    1,
    15,
    1000,
    100,
  );

  assert.equal(state.pr, 15);
  assert.equal(state.branch, 'codex/issue-1');
  assert.equal(state.status, 'worker_running');
  assert.deepEqual(state.completedIssues, [2]);
  assert.equal(state.workerPid, -1);
  assert.equal(state.workerHeartbeatAt, 899);
  assert.equal(state.reviewRound, 4);
  assert.equal(state.lastQaFeedback, 'fix the boundary case');
  assert.equal(state.taskContext, 'recovered task context');
  assert.equal(state.headSha, 'head-15');
});

test('prepareRecovery preserves an existing collision-suffixed branch', () => {
  const state = prepareRecovery(
    { branch: 'codex/issue-1-071f', status: 'blocked' },
    1,
    15,
    1000,
    100,
  );

  assert.equal(state.branch, 'codex/issue-1-071f');
});

test('prepareRecovery persists the canonical branch from empty state', () => {
  const state = prepareRecovery({}, 31, 54, 1000, 100);

  assert.equal(state.issue, 31);
  assert.equal(state.pr, 54);
  assert.equal(state.branch, 'codex/issue-31');
  assert.equal(state.status, 'worker_running');
});

test('no-work done state clears all prior run context', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      status: 'blocked',
      pr: 14,
      branch: 'codex/issue-9',
      headSha: 'old-head',
      mainBaseSha: 'old-main',
      reviewRound: 4,
      lastCiFeedback: 'old CI',
      lastQaFeedback: 'old QA',
      lastStaffFeedback: 'old Staff',
      taskContext: 'old context',
      workerRunId: 'old-run',
      workerPid: 123,
      workerStartedAt: 1,
      workerHeartbeatAt: 1,
      workerRecoveryCount: 2,
      lastError: 'old error',
      completedIssues: [8],
      mainGreen: true,
    },
  });
  dispatcherHarness.setState({
    completedIssues: [8],
    mainGreen: true,
    status: undefined,
    issue: undefined,
    pr: undefined,
    branch: undefined,
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(dispatcherHarness.state(), {
    completedIssues: [8],
    mainGreen: true,
    status: 'done',
    drainStatus: 'done',
    updatedAt: dispatcherHarness.state().updatedAt,
  });
});

test('resetRunState clears stale run context and preserves completed issues', () => {
  const state = resetRunState(
    {
      issue: 21,
      pr: 20,
      branch: 'codex/issue-3',
      status: 'worker_recovery_pending',
      workerPid: -1,
      completedIssues: [1, 2, 3],
      mainGreen: true,
      lastError: 'stale worker',
    },
    () => false,
  );

  assert.deepEqual(state.completedIssues, [1, 2, 3]);
  assert.equal(state.status, undefined);
  assert.equal(state.pr, undefined);
  assert.equal(state.branch, undefined);
  assert.equal(state.lastError, undefined);
  assert.equal(state.drainStatus, 'running');
});

test('resetRunState refuses a live Worker', () => {
  assert.throws(
    () => resetRunState({ status: 'worker_running', workerPid: 123 }, () => true),
    /cannot reset while Worker process 123 is still running/,
  );
});

test('recoverStaleLock removes only a lock owned by a dead process', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.match(
    recoverStaleLock(root, () => false),
    /Recovered stale dispatcher lock/,
  );
  assert.equal(existsSync(lock), false);
  rmSync(root, { recursive: true, force: true });
});

test('recoverStaleLock refuses a live owner', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.throws(
    () => recoverStaleLock(root, () => true),
    (error) => error.exitCode === 3 && /owner PID 9999 is still running/.test(error.message),
  );
  assert.equal(existsSync(lock), true);
  rmSync(root, { recursive: true, force: true });
});

test('lock reclaim uses injected storage and process liveness seams', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.now = () => 100;
  dispatcherHarness.dependencies.tryAcquire = () => false;
  dispatcherHarness.dependencies.readOwner = () => ({ pid: 41, createdAt: 0, token: 'old' });
  dispatcherHarness.dependencies.processAlive = (pid) => (calls.push(`processAlive:${pid}`), false);
  dispatcherHarness.dependencies.tryBeginReclaim = (() => {
    let attempt = 0;
    return () => ++attempt > 1;
  })();
  dispatcherHarness.dependencies.readReclaimOwner = () => ({
    pid: 42,
    createdAt: 0,
    token: 'reclaimer',
  });
  dispatcherHarness.dependencies.abandonReclaim = () => calls.push('abandonReclaim');
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  const token = acquire(dispatcherHarness.dependencies, 10);

  assert.match(token, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'processAlive:41',
    'processAlive:42',
    'abandonReclaim',
    'finishReclaim',
  ]);
});
