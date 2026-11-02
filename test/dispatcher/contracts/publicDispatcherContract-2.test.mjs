import {
  assert,
  test,
  command,
  runCommand,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

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
