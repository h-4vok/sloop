import {
  assert,
  test,
  readFileSync,
  writeFileSync,
  existsSync,
  tmpdir,
  join,
  canonical,
  canonicalConfigYaml,
  configPaths,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('direct config init reports a storage failure without claiming success', async () => {
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: () => false,

    read: () => '',

    writeAtomically: () => {
      throw new Error('configuration disk is unavailable');
    },

    remove: () => undefined,
  };

  const exitCode = await runConfigCommand(
    'unused-root',
    ['--init'],
    undefined,
    undefined,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(errors, ['configuration disk is unavailable']);
});

test('wizard identifies legacy JSON and canonical fields without modifying config', async () => {
  const { root, file } = createConfigFixture();
  const legacyFile = join(root, 'sloop.config.json');
  writeFileSync(legacyFile, '{"legacy":true}\n');
  const logs = [];
  const logger = { log: (message) => logs.push(message), error: () => undefined };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'github.labels.eligible'],
    undefined,
    createMockScriptedIo([]),
    logger,
  );

  assert.equal(exitCode, 0);
  assert.match(logs.join('\n'), /Legacy JSON detected/);
  assert.match(logs.join('\n'), /github\.labels\.eligible: canonical read-only/);
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.equal(readFileSync(legacyFile, 'utf8'), '{"legacy":true}\n');
});

test('plain init creates canonical defaults without a TTY and never overwrites', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-direct-init-'));
  const file = join(root, 'sloop.config.yaml');

  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  const before = readFileSync(file, 'utf8');
  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('real readline wizard covers init, section, and leaf scopes with confirmation safety', async () => {
  const initRoot = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-'));
  const initIO = createMockScriptedIo(['subdir', 'y', 'n']);

  assert.equal(
    await runConfigCommand(initRoot, ['--init', '--wizard', 'workspace.path'], undefined, initIO),
    0,
    initIO.text(),
  );
  assert.ok(readFileSync(join(initRoot, 'sloop.config.yaml'), 'utf8').includes('#'));
  assert.match(initIO.text(), /recommendation:/);

  const section = createConfigFixture();
  assert.ok(
    configPaths('workspace').every((path) => path === 'workspace' || path.startsWith('workspace.')),
  );

  const leaf = createConfigFixture();
  const leafIO = createMockScriptedIo(['subdir', 'y']);
  assert.equal(await runConfigCommand(leaf.root, ['workspace.path'], undefined, leafIO), 0);
  assert.match(readFileSync(leaf.file, 'utf8'), /path:[\s\S]*?subdir/);
  assert.match(leafIO.text(), /workspace\.path[\s\S]*options:/);
});

test('interactive cancellation leaves bytes unchanged', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  const io = createMockScriptedIo(['subdir', 'n']);

  assert.equal(await runConfigCommand(root, ['workspace.path'], undefined, io), 0, io.text());
  assert.deepEqual(readFileSync(file), before);
  assert.match(io.text(), /workspace\.path[\s\S]*options:/);
});

test('init creates canonical YAML when a scoped prompt accepts its default', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-bare-init-'));
  const io = createMockScriptedIo(['', 'y', 'n']);

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  const file = join(root, 'sloop.config.yaml');
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, 'utf8').includes('#'));
});

test('init cancellation does not create YAML', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-bare-init-cancel-'));
  const io = createMockScriptedIo(['', 'n']);

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});
