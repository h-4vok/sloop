import {
  assert,
  join,
  spawnSync,
  test,
  eligible,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

test('status rejects unsupported flag combinations', { timeout: 10_000 }, () => {
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
