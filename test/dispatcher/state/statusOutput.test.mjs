import {
  assert,
  test,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

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
