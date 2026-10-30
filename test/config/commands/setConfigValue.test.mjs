import {
  assert,
  test,
  vi,
  readFileSync,
  writeFileSync,
  join,
  PassThrough,
  Writable,
  canonicalConfigYaml,
  runConfigCommand,
  setConfigValue,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('root scalar setter compatibility export reports an unknown path', async () => {
  const { root, file } = createConfigFixture();
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const fileStore = {
    exists: vi.fn(() => true),

    read: vi.fn(() => canonicalConfigYaml()),

    writeAtomically: vi.fn(),

    remove: vi.fn(),
  };
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };
  const reconciler = async () => undefined;

  const exitCode = await setConfigValue(
    root,
    file,
    'unknown.setting',
    'value',
    '--no-sync',
    reconciler,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.match(errorMessages[0], /^unknown path unknown\.setting; valid paths:/);
  assert.equal(fileStore.exists.mock.calls.length, 0);
});

test('scalar setter reports ignored unknown keys through the injected error logger', async () => {
  const { root, file } = createConfigFixture();
  writeFileSync(file, `${readFileSync(file, 'utf8')}futureSetting: true\n`);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--no-sync'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, [
    '$.futureSetting: unknown configuration key; ignoring it',
    '$.futureSetting: unknown configuration key; ignoring it',
  ]);
});

test('scalar setter cancellation preserves the original configuration bytes', async () => {
  const { root, file } = createConfigFixture();
  const original = readFileSync(file);
  const io = createMockScriptedIo(['n']);

  const exitCode = await runConfigCommand(
    root,
    ['workspace.path', 'checkout', '--no-sync'],
    undefined,
    io,
  );

  assert.equal(exitCode, 0, io.text());
  assert.deepEqual(readFileSync(file), original);
});

test('scalar setters apply without a TTY and reconcile only after the atomic write', async () => {
  const { root, file } = createConfigFixture();
  const events = [];
  const result = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--sync'],
    async (r, kind) => {
      events.push([kind, readFileSync(join(r, 'sloop.config.yaml'), 'utf8').includes('develop')]);
    },
  );

  assert.equal(result, 0);
  assert.deepEqual(events, [['github', true]]);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
});

test('scalar setters replace an existing configuration file', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file, 'utf8');

  assert.match(before, /baseBranch:[\s\S]*?\n    main/);
  assert.equal(await runConfigCommand(root, ['repository.baseBranch', 'develop', '--no-sync']), 0);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?\n    develop/);
  assert.notEqual(readFileSync(file, 'utf8'), before);
});

test('invalid scalar input fails before writing or reconciling', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  let hasReconciledConfiguration = false;
  const result = await runConfigCommand(
    root,
    ['arbiter.reviewRounds', 'not-an-integer', '--sync'],
    async () => {
      hasReconciledConfiguration = true;
    },
  );

  assert.equal(result, 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(hasReconciledConfiguration, false);
});
