import {
  assert,
  test,
  readFileSync,
  tmpdir,
  join,
  loadConfigText,
  configPaths,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  runConfigWizard,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('interactive init prompts for sync with injected IO when requested', async () => {
  const { root, file } = createConfigFixture();
  const reconciledKinds = [];
  const reconciler = async (_root, kind) => reconciledKinds.push(kind);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const scriptedIo = createMockScriptedIo(['develop', 'y', 'n', 'y']);
  const io = { ...scriptedIo, promptForSync: true, useColor: true };

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    true,
    undefined,
    reconciler,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reconciledKinds, ['github', 'skills']);
  assert.deepEqual(errorMessages, []);
  assert.match(scriptedIo.text(), /\u001b\[36mrepository\.baseBranch\u001b\[0m/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).repository.baseBranch, 'develop');
});

test('interactive init can skip the post-init sync prompt with injected IO', async () => {
  const { root, file } = createConfigFixture();
  const logs = [];
  const reconciledKinds = [];
  const reconciler = async (_root, kind) => reconciledKinds.push(kind);
  const logger = { log: (message) => logs.push(message), error: () => undefined };
  const scriptedIo = createMockScriptedIo(['develop', 'y', 'n', 'n']);
  const io = { ...scriptedIo, promptForSync: true };

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    true,
    undefined,
    reconciler,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reconciledKinds, []);
  assert.ok(
    logs.includes(
      'Prerequisites were not synchronized; run `sloop config install` to prepare them manually.',
    ),
  );
});

test('wizard retries invalid enum values without restarting init', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-wizard-retry-'));
  const io = createMockScriptedIo(['pijs', 'checkout', 'n']);
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  try {
    assert.equal(
      await runConfigCommand(root, ['--init', '--wizard', 'workspace.mode'], undefined, io),
      0,
    );
  } finally {
    console.error = error;
  }
  assert.match(errors.join('\n'), /expected one of: checkout, worktree/);
  assert.match(io.text(), /Leave empty to use "checkout" as default/);
});

test('typed registry exposes full, section, and leaf wizard scopes', () => {
  const all = configPaths();
  const workspace = configPaths('workspace');
  const leaf = configPaths('workspace.mode');

  assert.ok(all.length > workspace.length);
  assert.ok(workspace.length > leaf.length);
  assert.deepEqual(leaf, ['workspace.mode']);
  assert.ok(workspace.every((path) => path === 'workspace' || path.startsWith('workspace.')));
});
