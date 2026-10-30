import {
  assert,
  test,
  existsSync,
  tmpdir,
  join,
  PassThrough,
  Writable,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  parseCliCommand,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('config init/install retain distinct command identity', () => {
  const getCliCommand = (args) => {
    const parseResult = parseCliCommand(args);
    assert.equal(parseResult.ok, true);
    return parseResult.value;
  };
  const cliArgs = ['config', 'init'];
  const parsedCliCommand = getCliCommand(cliArgs);
  assert.deepEqual(parsedCliCommand, { kind: 'config', args: ['--init'] });
  const cliArgs2 = ['config', 'init', '--wizard'];
  const parsedCliCommand2 = getCliCommand(cliArgs2);
  assert.deepEqual(parsedCliCommand2, {
    kind: 'config',

    args: ['--init', '--wizard'],
  });
  const cliArgs3 = ['config', 'install'];
  const parsedCliCommand3 = getCliCommand(cliArgs3);
  assert.deepEqual(parsedCliCommand3, { kind: 'config', args: ['--install'] });
  const cliArgs4 = ['config', 'install', '--force'];
  const parsedCliCommand4 = getCliCommand(cliArgs4);
  assert.deepEqual(parsedCliCommand4, {
    kind: 'config',

    args: ['--install', '--force'],
  });
  const cliArgs5 = ['init'];
  const invalidCommandResult = parseCliCommand(cliArgs5);
  assert.equal(invalidCommandResult.ok, false);
  assert.match(invalidCommandResult.error, /unsupported|usage/i);
  const cliArgs6 = ['config'];
  const parsedCliCommand5 = getCliCommand(cliArgs6);
  assert.deepEqual(parsedCliCommand5, { kind: 'config', args: [] });
  const cliArgs7 = ['config', 'workspace'];
  const parsedCliCommand6 = getCliCommand(cliArgs7);
  assert.deepEqual(parsedCliCommand6, {
    kind: 'config',

    args: ['workspace'],
  });
});

test('config install asks for confirmation unless forced', async () => {
  const { root } = createConfigFixture();
  const skipped = createMockScriptedIo(['n']);
  let calls = 0;
  const reconciler = async () => {
    calls++;
  };

  assert.equal(await runConfigCommand(root, ['--install'], reconciler, skipped), 0);
  assert.equal(calls, 0);
  assert.match(skipped.text(), /Install configured GitHub labels and Sloop skills now/);
  const forced = await runConfigCommand(root, ['--install', '--force'], reconciler);
  assert.equal(forced, 0);
  assert.equal(calls, 1);
});

test('config install rejects missing configuration without side effects', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-install-missing-'));
  let hasReconcilerRun = false;
  const result = await runConfigCommand(root, ['--install'], async () => {
    hasReconcilerRun = true;
  });

  assert.equal(result, 2);
  assert.equal(hasReconcilerRun, false);
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

test('config install requires a TTY unless forced', async () => {
  const { root } = createConfigFixture();
  const input = new PassThrough();
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  let hasReconcilerRun = false;
  const result = await runConfigCommand(
    root,
    ['--install'],
    async () => {
      hasReconcilerRun = true;
    },
    { input, output },
  );

  assert.equal(result, 2);
  assert.equal(hasReconcilerRun, false);
});

test('invalid config command forms return the usage exit code', async () => {
  const { root } = createConfigFixture();
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };
  const exitCodes = [
    await runConfigCommand(root, ['--sync', '--no-sync'], undefined, io),
    await runConfigCommand(root, ['--wizard'], undefined, io),
    await runConfigCommand(root, ['workspace.path', 'subdir'], undefined, io),
  ];

  assert.deepEqual(exitCodes, [2, 2, 2]);
});
