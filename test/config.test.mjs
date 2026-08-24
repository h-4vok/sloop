import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ConfigValidationError,
  canonicalConfigYaml,
  configFingerprint,
  configRegistry,
  loadConfigFile,
  loadConfigText,
  updateConfigFile,
  updateConfigText,
} from '../dist/config.js';

const canonical = canonicalConfigYaml();

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
  }
});

test('defaults and every registered parser round trip through canonical YAML', () => {
  const config = loadConfigText(canonical);
  for (const entry of configRegistry)
    assert.notEqual(entry.parser(entry.default, `$.${entry.path}`), undefined);
  assert.deepEqual(config.workflow.reviewOrder, ['qa', 'staff']);
  assert.equal(config.workflow.humanMergeWait, true);
  assert.equal(config.arbiter.reviewRounds, 3);
  assert.equal(config.arbiter.stagnatingAppearances, 2);
  assert.equal(config.arbiter.decisions, 2);
});

test('invalid documents provide exact YAML paths', () => {
  const cases = [
    [
      canonical.replace(
        'schemaVersion:\n  # Version of the tracked configuration contract.\n  1',
        'schemaVersion: 2',
      ),
      '$.schemaVersion: unsupported schema version',
    ],
    [`${canonical}\nunknown: true\n`, '$.unknown: unknown configuration key'],
    [
      canonical.replace('- staff\n  verification:', '- qa\n  verification:'),
      '$.workflow.reviewOrder: must contain qa and staff exactly once',
    ],
    [
      canonical.replace('"[Staff Review]"', '"[QA/SDET Review]"'),
      '$.github.roleMarkers: role markers must be unique',
    ],
    [
      canonical.replace('    - - npm\n      - test', '    - - npm\n      - "test && rm"'),
      '$.workflow.verification[0][1]: shell operators are forbidden',
    ],
    [
      canonical
        .replace(
          'expression:\n    # Platform scheduler expression.\n    ""',
          'expression:\n    # Platform scheduler expression.\n    ""',
        )
        .replace(
          'schedule:\n  enabled:\n    # Whether scheduler reconciliation is requested.\n    false',
          'schedule:\n  enabled:\n    # Whether scheduler reconciliation is requested.\n    true',
        ),
      '$.schedule.expression: is required',
    ],
  ];
  for (const [source, expected] of cases)
    assert.throws(
      () => loadConfigText(source),
      (error) => error instanceof ConfigValidationError && error.message.includes(expected),
    );
  assert.throws(() => loadConfigText('schemaVersion: ['), /\$: invalid YAML:/);
});

test('JSON input is rejected with init guidance', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-config-'));
  try {
    const file = join(root, 'sloop.config.json');
    writeFileSync(file, '{}');
    assert.throws(
      () => loadConfigFile(file),
      /pre-alpha JSON configuration is unsupported; run `sloop init`/,
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
  const root = mkdtempSync(join(tmpdir(), 'sloop-config-'));
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
