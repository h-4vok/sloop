import {
  assert,
  test,
  prepareRecovery,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

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
