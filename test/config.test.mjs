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

test('argv rejects shell interpreters across supported platforms', () => {
  for (const [command, expectedPath] of [
    [['sh', '-c', 'rm -rf /tmp/x'], '$.health.command[0]'],
    [['/bin/bash', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['bash-5.2', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['C:\\Windows\\System32\\cmd.exe', '/c', 'echo unsafe'], '$.health.command[0]'],
    [['pwsh.exe', '-Command', 'Write-Output unsafe'], '$.health.command[0]'],
    [['hush', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['/usr/bin/yash', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['/usr/local/bin/pdksh', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['ksh93', '-c', 'echo unsafe'], '$.health.command[0]'],
    [['busybox', 'hush', '-c', 'echo unsafe'], '$.health.command[1]'],
    [['toybox', 'sh', '-c', 'echo unsafe'], '$.health.command[1]'],
    [['env', 'zsh', '-c', 'echo unsafe'], '$.health.command[1]'],
    [['env', 'zsh-5.9', '-c', 'echo unsafe'], '$.health.command[1]'],
  ])
    assert.throws(
      () =>
        configRegistry
          .find(({ path }) => path === 'health.command')
          .parser(command, '$.health.command'),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: shell interpreters are forbidden`),
    );
});

test('argv rejects env split-string command dispatch', () => {
  for (const [command, expectedPath] of [
    [['env', '-S', 'sh -c', '?'], '$.health.command[1]'],
    [['env', '-Ssh -c', '?'], '$.health.command[1]'],
    [['/usr/bin/env', '--split-string=sh -c', '?'], '$.health.command[1]'],
  ])
    assert.throws(
      () =>
        configRegistry
          .find(({ path }) => path === 'health.command')
          .parser(command, '$.health.command'),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: env split-string options are forbidden`),
    );
});

test('malformed containers and list fields produce validation diagnostics', () => {
  for (const [source, expected] of [
    ['schemaVersion: 1\nrepository: invalid\n', '$.repository: expected a YAML mapping'],
    ['schemaVersion: 1\nworkflow:\n  reviewOrder: qa\n', '$.workflow.reviewOrder: expected a list'],
    ['schemaVersion: 1\nworkflow: invalid\n', '$.workflow: expected a YAML mapping'],
    ['schemaVersion: 1\ngithub:\n  labels: invalid\n', '$.github.labels: expected a YAML mapping'],
  ])
    assert.throws(
      () => loadConfigText(source),
      (error) => error instanceof ConfigValidationError && error.message.includes(expected),
    );
});

test('inherited property names are rejected as unknown keys at exact paths', () => {
  for (const [source, expectedPath] of [
    ['schemaVersion: 1\n"constructor": invalid\n', '$.constructor'],
    ['schemaVersion: 1\n"toString": invalid\n', '$.toString'],
    ['schemaVersion: 1\n"hasOwnProperty": invalid\n', '$.hasOwnProperty'],
    ['schemaVersion: 1\n"__proto__": invalid\n', '$.__proto__'],
    ['schemaVersion: 1\nrepository:\n  "constructor": invalid\n', '$.repository.constructor'],
  ])
    assert.throws(
      () => loadConfigText(source),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: unknown configuration key`),
    );
});

test('credential-bearing values are rejected while ordinary public values remain fingerprinted', () => {
  for (const [remote, expectedPath] of [
    ['https://x-access-token:ghp_example@example.com/org/repo.git', '$.repository.remote'],
    ['github_pat_1234567890_example', '$.repository.remote'],
    ['ghp_1234567890example', '$.repository.remote'],
  ]) {
    const source = canonical.replace(
      'remote:\n    # Git remote used for Sloop branches.\n    origin',
      `remote: "${remote}"`,
    );
    assert.throws(
      () => loadConfigText(source),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: credentials are not accepted`),
    );
  }
  const publicRemote = loadConfigText(
    canonical.replace(
      'remote:\n    # Git remote used for Sloop branches.\n    origin',
      'remote: upstream',
    ),
  );
  assert.notEqual(configFingerprint(publicRemote), configFingerprint(loadConfigText(canonical)));
});

test('credential-bearing headers and assignments are rejected in argv fields', () => {
  for (const [command, expectedPath] of [
    [
      ['curl', '-H', 'Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[2]',
    ],
    [['curl', '-H', 'Authorization: token opaque-secret'], '$.health.command[2]'],
    [['curl', '-H', 'Private-Token: opaque-secret'], '$.health.command[2]'],
    [['curl', '--header', 'X-Api-Key: opaque-secret'], '$.health.command[2]'],
    [
      ['curl', '--header=Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[1]',
    ],
    [['curl', '--user', 'alice:supersecret', 'https://example.com'], '$.health.command[2]'],
    [['curl', '--user=alice:supersecret', 'https://example.com'], '$.health.command[1]'],
    [
      ['git', '-c', 'http.extraHeader=Authorization: Bearer secret-value', 'fetch'],
      '$.health.command[2]',
    ],
    [['curl', 'https://example.com/?access_token=secret-value'], '$.health.command[1]'],
    [['curl', '-H', 'Proxy-Authorization: Basic dXNlcjpwYXNz'], '$.health.command[2]'],
    [['tool', 'api_key=secret-value'], '$.health.command[1]'],
    [['tool', 'password:secret-value'], '$.health.command[1]'],
    [['tool', '-----BEGIN PRIVATE KEY-----'], '$.health.command[1]'],
  ]) {
    const source = canonical.replace(
      'command:\n    # Health probe argv; never evaluated by a shell.\n    - gh\n    - run\n    - list\n    - --branch\n    - main',
      `command: ${JSON.stringify(command)}`,
    );
    assert.throws(
      () => loadConfigText(source),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: credentials are not accepted`),
    );
  }
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
