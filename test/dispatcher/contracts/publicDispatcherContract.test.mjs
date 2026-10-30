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
