import {
  assert,
  test,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  ConfigValidationError,
  canonical,
  configFileStore,
  loadConfigFile,
  loadConfigText,
  updateConfigFile,
  updateConfigText,
  configFileExists,
  loadConfigTextResult,
  updateConfigTextResult,
  createIsolatedTemporaryDirectory,
} from '../../support/config-test-helpers.mjs';

test('numeric duration updates preserve their millisecond value', () => {
  const updated = updateConfigText(canonical, 'agents.worker.timeout', 123);

  assert.match(updated, /timeout:\s*\n\s*# worker runner timeout in milliseconds\.\s*\n\s*123/);
});

test('Node configuration file store removes a file that was rolled back', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-remove-'));
  const removedFile = join(root, 'sloop.config.yaml');
  writeFileSync(removedFile, canonical);

  configFileStore.remove(removedFile);

  assert.equal(configFileStore.exists(removedFile), false);
  rmSync(root, { recursive: true, force: true });
});

test('configuration text operations return expected failures as structured results', () => {
  const malformedYamlResult = loadConfigTextResult('schemaVersion: [');
  const unknownPathResult = updateConfigTextResult(canonical, 'missing.path', 'value');

  assert.equal(malformedYamlResult.ok, false);
  assert.equal(unknownPathResult.ok, false);
  if (!malformedYamlResult.ok)
    assert.ok(malformedYamlResult.error instanceof ConfigValidationError);
  if (!unknownPathResult.ok)
    assert.match(unknownPathResult.error.message, /unknown configuration key/);
});

test('configuration text update returns malformed YAML as a structured failure', () => {
  const updateResult = updateConfigTextResult('schemaVersion: [', 'workspace.path', 'checkout');

  assert.equal(updateResult.ok, false);
  if (!updateResult.ok) assert.match(updateResult.error.message, /invalid YAML/);
});

test('configuration text update returns known-field validation failures as data', () => {
  const updateResult = updateConfigTextResult(canonical, 'workspace.path', '');

  assert.equal(updateResult.ok, false);
  if (!updateResult.ok)
    assert.equal(updateResult.error.message, '$.workspace.path: expected a non-empty string');
});

test('YAML aliases are rejected with a stable validation diagnostic', () => {
  assert.throws(
    () =>
      loadConfigText(
        'schemaVersion: 1\nrepository: &repo\n  remote: origin\n  baseBranch: main\n  branchPrefix: *repo\n',
      ),
    (error) =>
      error instanceof ConfigValidationError &&
      error.message === '$: YAML aliases are not supported in sloop.config.yaml',
  );
});

test('JSON input is rejected with init guidance', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-'));

  try {
    const file = join(root, 'sloop.config.json');
    writeFileSync(file, '{}');
    assert.throws(
      () => loadConfigFile(file),
      /pre-alpha JSON configuration is unsupported; run `sloop config init/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AST update preserves comments and order and validates the resulting document', () => {
  const source = canonical.replace('repository:\n', '# repository note\nrepository:\n');
  const updated = updateConfigText(source, 'repository.baseBranch', 'develop');

  assert.match(updated, /# repository note\nrepository:/);
  assert.equal(updated.indexOf('repository:'), source.indexOf('repository:'));
  assert.equal(loadConfigText(updated).repository.baseBranch, 'develop');
  assert.throws(
    () => updateConfigText(source, 'repository.nope', true),
    /unknown configuration key/,
  );
});

test('file update uses atomic replacement and leaves no temporary sibling', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-'));

  try {
    const file = join(root, 'sloop.config.yaml');
    writeFileSync(file, canonical);
    updateConfigFile(file, 'loop.interval', '10m');
    assert.equal(loadConfigFile(file).loop.interval, 600_000);
    assert.match(readFileSync(file, 'utf8'), /10m/);
    assert.deepEqual(readdirSync(root), ['sloop.config.yaml']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('config text updates report malformed YAML', () => {
  const updateMalformedYaml = () =>
    updateConfigText('workflow: [', 'workflow.humanMergeWait', false);

  assert.throws(updateMalformedYaml, /invalid YAML/);
});

test('config file existence is a direct filesystem contract', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-exists-'));
  const file = join(root, 'sloop.config.yaml');

  assert.equal(configFileExists(file), false);
  writeFileSync(file, canonical);
  assert.equal(configFileExists(file), true);
  rmSync(root, { recursive: true, force: true });
});
