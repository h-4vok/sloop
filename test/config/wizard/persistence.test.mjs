import {
  assert,
  test,
  readFileSync,
  writeFileSync,
  join,
  PassThrough,
  Writable,
  loadConfigText,
  runConfigCommand,
  runConfigWizard,
  runConfigCommandService,
  runConfigWizardService,
  setConfigValueService,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('application config service objects are available through the application barrel', () => {
  assert.equal(typeof runConfigCommandService.run, 'function');
  assert.equal(typeof runConfigWizardService.run, 'function');
  assert.equal(typeof setConfigValueService.run, 'function');
});

test('config command rejects invalid flag combinations and unknown paths without TTY', async () => {
  const { root } = createConfigFixture();
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };

  assert.equal(await runConfigCommand(root, ['--sync', '--no-sync'], undefined, io), 2);
  assert.equal(await runConfigCommand(root, ['schedule.cron'], undefined, io), 2);
  assert.equal(await runConfigCommand(root, ['--wizard'], undefined, io), 2);
});

test('interactive wizard reports unknown keys through the injected error logger', async () => {
  const { root, file } = createConfigFixture();
  writeFileSync(file, `${readFileSync(file, 'utf8')}futureSetting: true\n`);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const io = createMockScriptedIo(['']);

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    false,
    '--no-sync',
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, [
    '$.futureSetting: unknown configuration key; ignoring it',
    '$.futureSetting: unknown configuration key; ignoring it',
  ]);
});

test('wizard skips dependent settings after their companion is disabled', async () => {
  const { root, file } = createConfigFixture();
  const disabledConfiguration = readFileSync(file, 'utf8').replace(
    '  enabled:\n    # Whether base health gates new work.\n    true',
    '  enabled:\n    # Whether base health gates new work.\n    false',
  );
  writeFileSync(file, disabledConfiguration);
  const io = createMockScriptedIo(['']);
  const logs = [];
  const logger = { log: (message) => logs.push(message), error: () => undefined };

  const exitCode = await runConfigCommand(root, ['health', '--no-sync'], undefined, io, logger);

  assert.equal(exitCode, 0, io.text());
  assert.match(logs.join('\n'), /health\.command is inactive because health\.enabled=true/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).health.enabled, false);
});

test('unknown wizard scopes fail with valid-path guidance before entering the TTY wizard', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['definitely.not.a.path']), 2);
});
