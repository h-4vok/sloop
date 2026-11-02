import {
  assert,
  test,
  vi,
  readFileSync,
  writeFileSync,
  tmpdir,
  join,
  canonical,
  canonicalConfigYaml,
  loadConfigText,
  createIsolatedTemporaryDirectory,
  runConfigCommand,
  createConfigFixture,
  createMockScriptedIo,
} from '../../support/config-test-helpers.mjs';

test('wizard retries invalid argv JSON without changing the configuration', async () => {
  const { root, file } = createConfigFixture();
  const original = readFileSync(file, 'utf8');
  const io = createMockScriptedIo(['not-json', '["git","status"]', 'n']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['health.command', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0, io.text());
  assert.match(errors.join('\n'), /expected valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('sandbox wizard exposes and persists the explicit danger-full-access option', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['danger-full-access', 'y', 'n']);
  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    assert.equal(
      await runConfigCommand(root, ['--init', '--wizard', 'agents.worker.sandbox'], undefined, io),
      0,
    );
  } finally {
    console.log = log;
  }
  assert.match(io.text(), /options: read-only, workspace-write, danger-full-access/);
  assert.match(logs.join('\n'), /agents\.worker\.sandbox: workspace-write -> danger-full-access/);
  assert.match(readFileSync(file, 'utf8'), /sandbox:[\s\S]*?\n\s+danger-full-access/);
});

test('config init migrates legacy skill names to canonical names', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-branches-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, canonicalConfigYaml().replaceAll('sloop-worker', 'worker'));
  const initExitCode = await runConfigCommand(root, ['--init']);
  const migratedConfiguration = readFileSync(file, 'utf8');

  assert.equal(initExitCode, 0);
  assert.match(migratedConfiguration, /sloop-worker/);
});

test('config init reports unknown keys while migrating legacy skill names', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-unknown-migration-'));
  const file = join(root, 'sloop.config.yaml');
  const configWithLegacySkill = canonicalConfigYaml().replaceAll('sloop-worker', 'worker');
  const configWithUnknownKey = `${configWithLegacySkill}\nfutureSetting: true\n`;
  const logger = { log: vi.fn(), error: vi.fn() };
  writeFileSync(file, configWithUnknownKey);

  const exitCode = await runConfigCommand(root, ['--init'], undefined, undefined, logger);

  assert.equal(exitCode, 0);
  assert.match(readFileSync(file, 'utf8'), /sloop-worker/);
  assert.deepEqual(logger.error.mock.calls, [
    ['$.futureSetting: unknown configuration key; ignoring it'],
  ]);
});

test('wizard trims comma-separated required skill names before persisting them', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['sloop-worker, sloop-qa', 'y']);

  const exitCode = await runConfigCommand(root, ['skills.required', '--no-sync'], undefined, io);

  assert.equal(exitCode, 0, io.text());
  assert.deepEqual(loadConfigText(readFileSync(file, 'utf8')).skills.required, [
    'sloop-worker',
    'sloop-qa',
  ]);
});
