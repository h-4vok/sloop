import {
  assert,
  test,
  canonical,
  canonicalConfigYaml,
  configFingerprint,
  configRegistry,
  loadConfigText,
  updateConfigText,
  configPaths,
  configValue,
  getConfigField,
} from '../../support/config-test-helpers.mjs';

test('canonical schema produces an immutable typed config and stable redacted fingerprint', () => {
  const first = loadConfigText(canonical);
  const second = loadConfigText(
    canonical.replace(
      'path:\n    # Checkout path used in checkout mode.\n    .',
      'path:\n    # Checkout path used in checkout mode.\n    C:/private/checkout',
    ),
  );

  assert.equal(first.schemaVersion, 1);
  assert.equal(first.loop.interval, 300_000);
  assert.equal(first.agents.worker.timeout, 600_000);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.repository));
  assert.equal(configFingerprint(first), configFingerprint(second), 'sensitive paths are redacted');
  assert.match(configFingerprint(first), /^[a-f0-9]{64}$/);
});

test('registry is the single complete metadata source', () => {
  assert.ok(configRegistry.length > 30);
  assert.equal(new Set(configRegistry.map(({ path }) => path)).size, configRegistry.length);
  for (const entry of configRegistry) {
    for (const key of [
      'path',
      'type',
      'parser',
      'validation',
      'explanation',
      'choices',
      'recommendation',
      'dependencies',
      'default',
      'sensitivity',
      'requiredReconciler',
    ])
      assert.ok(key in entry, `${entry.path} lacks ${key}`);
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.default));
    assert.ok(Object.isFrozen(entry.choices));
    assert.ok(Object.isFrozen(entry.dependencies));
  }
});

test('registry nested metadata and defaults cannot be mutated by consumers', () => {
  const priority = configRegistry.find(({ path }) => path === 'github.labels.priority');

  assert.throws(() => priority.default.push('injected'), TypeError);
  assert.throws(() => priority.dependencies.push('injected=true'), TypeError);
  assert.deepEqual(loadConfigText(canonical).github.labels.priority, priority.default);
});

test('defaults and every registered parser round trip through canonical YAML', () => {
  const config = loadConfigText(canonical);

  for (const entry of configRegistry)
    assert.equal(entry.parser(entry.default, `$.${entry.path}`).ok, true);
  assert.deepEqual(config.workflow.reviewOrder, ['qa']);
  assert.equal(config.workflow.humanMergeWait, true);
  assert.equal(config.arbiter.reviewRounds, 3);
  assert.equal(config.arbiter.stagnatingAppearances, 2);
  assert.equal(config.arbiter.decisions, 2);
});

test('registry string parser reports invalid values at the supplied path', () => {
  const expressionField = configRegistry.find(({ path }) => path === 'schedule.expression');
  const result = expressionField.parser(42, '$.schedule.expression');

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, '$.schedule.expression: expected a string');
});

test('config path helpers return values and empty results for unknown paths', () => {
  const value = loadConfigText(canonical);
  const remoteName = configValue(value, 'repository.remote');
  const missingField = getConfigField('missing.path');
  const missingPaths = configPaths('missing.path');

  assert.equal(remoteName, 'origin');
  assert.equal(missingField, undefined);
  assert.deepEqual(missingPaths, []);
});

test('boolean registry fields round-trip through canonical text updates', () => {
  const source = canonicalConfigYaml();
  const updated = updateConfigText(source, 'workflow.humanMergeWait', false);
  const config = loadConfigText(updated);

  assert.equal(config.workflow.humanMergeWait, false);
  assert.equal(
    getConfigField('workflow.humanMergeWait').explanation,
    'Wait for a human to merge an approved PR.',
  );
});
