import {
  assert,
  test,
  join,
  ConfigValidationError,
  loadConfigText,
  getConfigField,
  parseConfigResult,
  parseConfigValueResult,
  createConfigWithRemote,
} from '../../support/config-test-helpers.mjs';

test('configuration parser returns validation failures as structured results', () => {
  const invalidConfiguration = { schemaVersion: 2 };

  const parseResult = parseConfigResult(invalidConfiguration);

  assert.equal(parseResult.ok, false);
  if (!parseResult.ok) {
    assert.ok(parseResult.error instanceof ConfigValidationError);
    assert.match(parseResult.error.message, /unsupported schema version/);
  }
});

test('configuration parser returns validated values as successful results', () => {
  const parseResult = parseConfigResult({ schemaVersion: 1 });

  assert.equal(parseResult.ok, true);
  if (parseResult.ok) assert.equal(parseResult.value.schemaVersion, 1);
});

test('configuration parser returns a structured failure for non-mapping input', () => {
  const parseResult = parseConfigResult(null);

  assert.equal(parseResult.ok, false);
  if (!parseResult.ok) assert.match(parseResult.error.message, /expected a YAML mapping/);
});

test('configuration parser propagates unexpected unknown-key callback failures', () => {
  const callbackFailure = new Error('warning logger failed');

  assert.throws(
    () =>
      parseConfigResult({ schemaVersion: 1, futureSetting: true }, () => {
        throw callbackFailure;
      }),
    callbackFailure,
  );
});

test('configuration value result rethrows unexpected parser failures', () => {
  const unexpectedFailure = new Error('parser implementation failed');
  const field = {
    path: 'workspace.path',

    parser: () => {
      throw unexpectedFailure;
    },
  };

  assert.throws(() => parseConfigValueResult(field, 'checkout'), unexpectedFailure);
});

for (const [credentialType, remote] of [
  ['an AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
  [
    'a Slack bot token',
    ['xoxb', '123456789012', '123456789012', 'abcdefghijklmnopqrstuvwx'].join('-'),
  ],
  ['a Stripe secret key', ['sk', 'live', '1234567890abcdefghijklmnop'].join('_')],
]) {
  test('config parser rejects ' + credentialType + ' in the repository remote', () => {
    const source = createConfigWithRemote(remote);
    const parseCredentialRemote = () => loadConfigText(source);

    assert.throws(
      parseCredentialRemote,
      (error) =>
        error instanceof ConfigValidationError &&
        error.message ===
          '$.repository.remote: credentials are not accepted in sloop.config.yaml; use the external environment',
    );
  });
}

test('config value parser converts boolean, integer, and duration fields', () => {
  const parsedValues = [
    parseConfigValueResult(getConfigField('health.enabled'), 'false'),
    parseConfigValueResult(getConfigField('arbiter.decisions'), '4'),
    parseConfigValueResult(getConfigField('loop.interval'), '3s'),
  ];

  assert.ok(parsedValues.every((result) => result.ok));
  assert.deepEqual(
    parsedValues.map((result) => (result.ok ? result.value : undefined)),
    [false, 4, 3000],
  );
});

test('config value result rejects boolean text outside true and false', () => {
  const result = parseConfigValueResult(getConfigField('health.enabled'), 'sometimes');

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, '$.health.enabled: expected a boolean');
});

test('config value parser rejects invalid list values', () => {
  const parseResult = parseConfigValueResult(getConfigField('skills.required'), 'x');

  assert.equal(parseResult.ok, false);
  if (!parseResult.ok) assert.ok(parseResult.error instanceof ConfigValidationError);
});
