import {
  assert,
  test,
  vi,
  command,
  CliFailure,
  dispatch,
  createMockDispatcherHarness,
  prepareRecovery,
  resolveReviewCap,
  runDispatcherCli,
  parseDispatcherCommand,
} from '../dispatcher-test-support.mjs';

test('legacy dispatcher entry point forwards its command line to the CLI', async () => {
  const originalArgv = process.argv;
  const runCli = vi.fn(async () => {});
  vi.doMock('../../../src/cli.js', () => ({ cli: { runCli } }));

  try {
    process.argv = [process.execPath, '/legacy/dispatcher.js', 'status', '--json'];
    vi.resetModules();
    await import('../../../src/dispatcher.js');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(runCli.mock.calls, [[['status', '--json']]]);
  } finally {
    process.argv = originalArgv;
    vi.doUnmock('../../../src/cli.js');
    vi.resetModules();
  }
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

test('public CLI status, list, recovery, and reset commands use injected controls', async () => {
  const fixture = createInjectedControlFixture();

  await runInjectedCommands(fixture.harness, [
    ['--status', '--verbose'],
    ['--list'],
    ['--recover-lock'],
    ['--reset'],
    ['--reset-mutex'],
  ]);

  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ['status', 'list', 'recoverLock', 'reset', 'resetMutex'],
  );
  assert.deepEqual(
    fixture.calls.find(([name]) => name === 'status'),
    ['status', true],
  );
});

test('public CLI returns a blocked exit when a live mutex owner refuses reset', async () => {
  const fixture = createInjectedControlFixture();
  const originalError = console.error;
  const errorMessages = [];
  fixture.harness.dependencies.resetMutex = () => ({
    ok: false,
    error: 'Cannot reset the repository mutex while Sloop process 7004 is active.',
  });
  console.error = (message) => errorMessages.push(message);

  try {
    const command = parseDispatcherCommand(['--reset-mutex']);
    const exitCode = await runDispatcherCli(command, fixture.harness.dependencies);

    assert.equal(exitCode, 4);
    assert.deepEqual(errorMessages, [
      '[sloop] Cannot reset the repository mutex while Sloop process 7004 is active.',
    ]);
  } finally {
    console.error = originalError;
  }
});

test('public CLI review-cap and recovery commands use injected controls', async () => {
  const fixture = createInjectedControlFixture();

  await runInjectedCommands(fixture.harness, [
    ['--resolve-review-cap', '--steer', 'continue', '--additional-rounds', '1'],
    ['--link-issue', '29'],
    ['--prepare-recovery', '28', '--pr', '49'],
  ]);

  assert.deepEqual(
    fixture.calls.map(([name]) => name),
    ['loadConfig', 'resolveReviewCap', 'linkIssue', 'loadConfig', 'prepareRecovery'],
  );
  assert.deepEqual(
    fixture.calls.find(([name]) => name === 'linkIssue'),
    ['linkIssue', 29],
  );
  assert.deepEqual(fixture.calls.find(([name]) => name === 'prepareRecovery').slice(0, 3), [
    'prepareRecovery',
    28,
    49,
  ]);
});

function createInjectedControlFixture() {
  const harness = createMockDispatcherHarness([], {
    initialState: { issue: 28, pr: 49, status: 'blocked' },
  });
  const calls = [];
  const dependencies = harness.dependencies;
  dependencies.loadConfig = () => (calls.push(['loadConfig']), harness.cfg);
  dependencies.status = (verbose) => (calls.push(['status', verbose]), { status: 'injected' });
  dependencies.list = () => (calls.push(['list']), [{ number: 28, title: 'injected' }]);
  dependencies.recoverLock = () => (calls.push(['recoverLock']), 'injected recovery');
  dependencies.reset = () => calls.push(['reset']);
  dependencies.resetMutex = () => (
    calls.push(['resetMutex']),
    { ok: true, value: 'Repository mutex reset.' }
  );
  dependencies.resolveReviewCap = (args, config) => calls.push(['resolveReviewCap', args, config]);
  dependencies.linkIssue = (issue) => calls.push(['linkIssue', issue]);
  dependencies.prepareRecovery = (issue, pr, config) => (
    calls.push(['prepareRecovery', issue, pr, config]),
    49
  );
  return { harness, calls };
}

async function runInjectedCommands(harness, commands) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (const dispatcherArgs of commands) {
      const parsedCommand = parseDispatcherCommand(dispatcherArgs);
      await runDispatcherCli(parsedCommand, harness.dependencies);
    }
  } finally {
    console.log = originalLog;
  }
}
