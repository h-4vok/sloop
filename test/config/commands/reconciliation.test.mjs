import {
  assert,
  test,
  readFileSync,
  existsSync,
  tmpdir,
  join,
  PassThrough,
  Writable,
  loadConfigText,
  createIsolatedTemporaryDirectory,
  reconcileConfig,
  runConfigCommand,
  runConfigWizard,
  productionConfigReconciler,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('interactive wizard uses the default reconciler when sync is requested', async () => {
  const { root, file } = createConfigFixture();
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const io = createMockScriptedIo(['develop', 'y']);

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    false,
    '--sync',
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errorMessages[0], /No production reconciler is available for github/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).repository.baseBranch, 'develop');
});

test('non-interactive init supports forced synchronization success and failure', async () => {
  const first = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-sync-'));
  const calls = [];
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };

  assert.equal(
    await runConfigCommand(
      first,
      ['--init', '--force'],
      async (_root, kind) => calls.push(kind),
      io,
    ),
    0,
  );
  assert.deepEqual(calls, ['github']);
  const second = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-sync-fail-'));
  assert.equal(
    await runConfigCommand(
      second,
      ['--init', '--force'],
      async () => {
        throw new Error('adapter down');
      },
      io,
    ),
    2,
  );
  assert.equal(existsSync(join(second, 'sloop.config.yaml')), true);
});

test('default reconciler fails visibly for mutation-capable integrations', async () => {
  await assert.rejects(() => reconcileConfig('.', 'github'), /No production reconciler/);

  assert.throws(() => reconcileConfig.preflight('.', 'skills'), /No production reconciler/);
  assert.doesNotThrow(() => reconcileConfig.preflight('.', 'none'));
});

test('production sync fails closed for every external reconciler kind', async () => {
  const { root, file } = createConfigFixture();
  for (const kind of ['github', 'workspace', 'skills', 'scheduler']) {
    await assert.rejects(() => productionConfigReconciler(root)(root, kind), new RegExp(kind));
  }
  const result = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--sync'],
    productionConfigReconciler(root),
  );

  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
});

test('production sync never reports success when no reconciler is installed', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file, 'utf8');
  const result = await runConfigCommand(root, ['repository.baseBranch', 'develop', '--sync']);

  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('config install reports a failure when its reconciler is unavailable', async () => {
  const { root } = createConfigFixture();
  const installWithUnavailableReconciler = () =>
    runConfigCommand(root, ['--install', '--force'], async () => {
      throw new Error('no access');
    });
  const exitCode = await installWithUnavailableReconciler();

  assert.equal(exitCode, 2);
});

test('forced config init requests GitHub reconciliation', async () => {
  const blank = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-direct-'));
  const events = [];
  const exitCode = await runConfigCommand(blank, ['--init', '--force'], async (_root, kind) =>
    events.push(kind),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['github']);
});
