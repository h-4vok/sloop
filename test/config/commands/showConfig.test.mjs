import {
  assert,
  test,
  vi,
  readFileSync,
  writeFileSync,
  tmpdir,
  join,
  PassThrough,
  Writable,
  canonicalConfigYaml,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  createConfigFixture,
} from '../../support/config-test-helpers.mjs';

test('config show reads through the injected configuration file store', async () => {
  const configurationText = canonicalConfigYaml();
  const loggerMessages = [];
  const fileStore = {
    exists: vi.fn(() => true),

    read: vi.fn(() => configurationText),

    writeAtomically: vi.fn(),

    remove: vi.fn(),
  };
  const logger = {
    log: (message) => loggerMessages.push(message),

    error: (message) => loggerMessages.push(message),
  };
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };

  const exitCode = await runConfigCommand(
    'mock-root',
    ['show', 'repository.remote'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(loggerMessages, ['"origin"']);
  assert.equal(fileStore.exists.mock.calls.length, 1);
  assert.equal(fileStore.read.mock.calls.length, 1);
});

test('config show reports ignored unknown keys through the error logger', async () => {
  const { root, file } = createConfigFixture();
  const configWithUnknownKey = `${readFileSync(file, 'utf8')}futureSetting: true\n`;
  writeFileSync(file, configWithUnknownKey);
  const errorMessages = [];
  const logger = {
    log: () => undefined,

    error: (message) => errorMessages.push(message),
  };

  const exitCode = await runConfigCommand(
    root,
    ['show', 'repository.remote'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, ['$.futureSetting: unknown configuration key; ignoring it']);
});

test('config show and scalar set report a missing configuration file', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-missing-'));
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const showExitCode = await runConfigCommand(root, ['show'], undefined, undefined, logger);
  const setExitCode = await runConfigCommand(
    root,
    ['workspace.path', 'checkout', '--no-sync'],
    undefined,
    undefined,
    logger,
  );

  assert.deepEqual([showExitCode, setExitCode], [2, 2]);
  assert.deepEqual(errors, [
    'No valid sloop.config.yaml; run sloop config init',
    'No valid sloop.config.yaml; run sloop config init',
  ]);
});

test('config show reports unknown paths with valid-path guidance', async () => {
  const { root } = createConfigFixture();
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['show', 'not.a.config.path'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errors[0], /unknown path not\.a\.config\.path; valid paths:/);
});

test('config show and scalar setters remain non-interactive while config wizard requires a TTY', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show', 'repository.baseBranch']), 0);
  assert.equal(await runConfigCommand(root, []), 2);
});

test('config show accepts full sections as well as leaves', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show', 'workspace']), 0);
  assert.equal(await runConfigCommand(root, ['show']), 0);
});

test('show reports the complete document and typed leaf values', async () => {
  const { root, file } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show']), 0);
  assert.equal(await runConfigCommand(root, ['show', 'schedule.enabled']), 0);
  assert.ok(readFileSync(file, 'utf8').includes('# Platform scheduler expression.'));
});
