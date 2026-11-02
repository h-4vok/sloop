import {
  assert,
  test,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  loadConfigFile,
  loadConfigText,
  parseConfig,
  parseConfigResult,
  createIsolatedTemporaryDirectory,
} from '../../support/config-test-helpers.mjs';

test('configuration parser ignores unknown keys when no warning callback is supplied', () => {
  const parseResult = parseConfigResult({ schemaVersion: 1, futureSetting: true });

  assert.equal(parseResult.ok, true);
  if (parseResult.ok) assert.equal(parseResult.value.schemaVersion, 1);
});

test('Node configuration file store warns when loading unknown keys', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-warning-'));
  const configurationFile = join(root, 'sloop.config.yaml');
  const warnings = [];
  const originalWarn = console.warn;
  writeFileSync(configurationFile, 'schemaVersion: 1\nfutureSetting: true\n');
  console.warn = (message) => warnings.push(message);

  try {
    const configuration = loadConfigFile(configurationFile);

    assert.equal(configuration.schemaVersion, 1);
    assert.deepEqual(warnings, ['$.futureSetting: unknown configuration key; ignoring it']);
  } finally {
    console.warn = originalWarn;
    rmSync(root, { recursive: true, force: true });
  }
});

test('inherited property names are ignored as unknown keys at exact paths', () => {
  for (const [source, expectedPath] of [
    ['schemaVersion: 1\n"constructor": invalid\n', '$.constructor'],
    ['schemaVersion: 1\n"toString": invalid\n', '$.toString'],
    ['schemaVersion: 1\n"hasOwnProperty": invalid\n', '$.hasOwnProperty'],
    ['schemaVersion: 1\n"__proto__": invalid\n', '$.__proto__'],
    ['schemaVersion: 1\nrepository:\n  "constructor": invalid\n', '$.repository.constructor'],
  ])
    assert.doesNotThrow(() => loadConfigText(source));
});

test('unknown credential-shaped subtrees are ignored after warning', () => {
  assert.doesNotThrow(() =>
    loadConfigText('schemaVersion: 1\nunknown:\n  token: ghp_1234567890example\n'),
  );
});

test('config parser ignores unknown keys', () => {
  const parseWithUnknownCredentialKey = () => parseConfig({ schemaVersion: 1, token: 'secret' });

  assert.doesNotThrow(parseWithUnknownCredentialKey);
});
