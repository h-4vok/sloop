import {
  assert,
  test,
  readFileSync,
  writeFileSync,
  tmpdir,
  join,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('first-time config init removes its YAML when the gitignore write fails', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-rollback-'));
  const io = createMockScriptedIo(['checkout', 'y', 'y']);
  const errors = [];
  let removedConfigCount = 0;
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: () => false,

    read: () => '',

    writeAtomically: (file) => {
      if (file.endsWith('.gitignore')) throw new Error('gitignore write failed');
    },

    remove: () => {
      removedConfigCount++;
    },
  };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.equal(removedConfigCount, 1);
  assert.deepEqual(errors, ['gitignore write failed']);
});

test('existing config init restores its prior YAML when the gitignore write fails', async () => {
  const { root, file } = createConfigFixture();
  const originalText = readFileSync(file, 'utf8');
  const storedFiles = new Map([[file, originalText]]);
  const io = createMockScriptedIo(['checkout', 'y', 'y']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: (path) => storedFiles.has(path),

    read: (path) => storedFiles.get(path),

    writeAtomically: (path, content) => {
      if (path.endsWith('.gitignore')) throw new Error('gitignore write failed');
      storedFiles.set(path, content);
    },

    remove: (path) => storedFiles.delete(path),
  };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.equal(storedFiles.get(file), originalText);
  assert.deepEqual(errors, ['gitignore write failed']);
});

test('workspace worktree root explains its mode dependency', async () => {
  const { root } = createConfigFixture();
  const io = createMockScriptedIo(['worktree', '.sloop/worktrees', 'n']);

  assert.equal(await runConfigCommand(root, ['workspace.worktreeRoot'], undefined, io), 0);
  assert.match(
    io.text(),
    /workspace\.mode \(required by workspace\.worktreeRoot; enter worktree\)/,
  );
  assert.match(io.text(), /workspace\.worktreeRoot\n/);
});

test('interactive init writes gitignore, list and argv wizard values, and synchronizes explicit kinds', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-interactive-'));
  writeFileSync(join(root, '.gitignore'), 'node_modules');
  const events = [];
  const io = createMockScriptedIo(['["git","status"]', 'y', 'y']);
  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'health.command', '--sync'],
    async (_root, kind) => events.push(kind),
    io,
  );
  const configurationText = readFileSync(join(root, 'sloop.config.yaml'), 'utf8');
  const gitignoreText = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.equal(exitCode, 0);
  assert.match(configurationText, /command:\n    - git\n    - status/);
  assert.match(gitignoreText, /\.sloop\//);
  assert.deepEqual(events, []);
});
