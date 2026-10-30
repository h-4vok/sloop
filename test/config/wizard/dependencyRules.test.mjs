import {
  assert,
  test,
  readFileSync,
  writeFileSync,
  join,
  loadConfigText,
  runConfigCommand,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('wizard retries blank and invalid dependency answers before canceling', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['', 'invalid-mode', 'worktree', '.sloop/worktrees', 'n']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['workspace.worktreeRoot', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0, io.text());
  assert.match(errors.join('\n'), /requires companion path workspace\.mode=worktree/);
  assert.match(errors.join('\n'), /expected one of: checkout, worktree/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).workspace.mode, 'checkout');
});

test('wizard rejects a valid but unsatisfied workspace dependency', async () => {
  const { root } = createConfigFixture();
  const io = createMockScriptedIo(['checkout']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['workspace.worktreeRoot', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /requires companion path workspace\.mode=worktree/);
});

test('wizard cancellation, dependency prompts, and legacy JSON are safe', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  writeFileSync(join(root, 'sloop.config.json'), '{"legacy":true}\n');
  const legacyBefore = readFileSync(join(root, 'sloop.config.json'));

  assert.deepEqual(readFileSync(join(root, 'sloop.config.json')), legacyBefore);
  assert.equal(await runConfigCommand(root, ['schedule.cron', '* * * * *', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('dependency preview shows the captured old value', async () => {
  const { root, file } = createConfigFixture();
  const source = readFileSync(file, 'utf8').replace(
    /  enabled:\n    # Whether base health gates new work\.\n    true/,
    '  enabled:\n    # Whether base health gates new work.\n    false',
  );
  writeFileSync(file, source);
  const io = createMockScriptedIo(['true', '["gh","run","list"]', 'n']);
  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    assert.equal(await runConfigCommand(root, ['health.command', '--no-sync'], undefined, io), 0);
  } finally {
    console.log = log;
  }
  assert.match(logs.join('\n'), /health\.enabled: false -> true/);
  assert.doesNotMatch(logs.join('\n'), /health\.enabled: true -> true/);
  assert.equal(readFileSync(file, 'utf8'), source);
});
