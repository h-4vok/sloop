import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  ConfigValidationError,
  canonicalConfigYaml,
  configFingerprint,
  configRegistry,
  configFileStore,
  loadConfigFile,
  loadConfigText,
  updateConfigFile,
  updateConfigText,
  configFileExists,
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  parseConfig,
  parseConfigResult,
  parseConfigValueResult,
  updateConfigTextResult,
} from '../src/config.js';

const canonical = canonicalConfigYaml();

function assertParserFailure(parser, value, path, matchesMessage) {
  const result = parser(value, path);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof ConfigValidationError);
    assert.ok(matchesMessage(result.error.message), result.error.message);
  }
}

function createConfigWithRemote(remote) {
  return canonical.replace(
    'remote:\n    # Git remote used for Sloop branches.\n    origin',
    'remote: "' + remote + '"',
  );
}

test('numeric duration updates preserve their millisecond value', () => {
  const updated = updateConfigText(canonical, 'agents.worker.timeout', 123);

  assert.match(updated, /timeout:\s*\n\s*# worker runner timeout in milliseconds\.\s*\n\s*123/);
});

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

test('invalid documents provide exact YAML paths', () => {
  const cases = [
    [
      canonical.replace(
        'schemaVersion:\n  # Version of the tracked configuration contract.\n  1',
        'schemaVersion: 2',
      ),
      '$.schemaVersion: unsupported schema version',
    ],
    [
      canonical
        .replace(
          "expression:\n    # Platform scheduler expression.\n    ''",
          "expression:\n    # Platform scheduler expression.\n    ''",
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

test('configuration parser ignores unknown keys when no warning callback is supplied', () => {
  const parseResult = parseConfigResult({ schemaVersion: 1, futureSetting: true });

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

test('registry string parser reports invalid values at the supplied path', () => {
  const expressionField = configRegistry.find(({ path }) => path === 'schedule.expression');
  const result = expressionField.parser(42, '$.schedule.expression');

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.message, '$.schedule.expression: expected a string');
});

test('Node configuration file store removes a file that was rolled back', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-remove-'));
  const removedFile = join(root, 'sloop.config.yaml');
  writeFileSync(removedFile, canonical);

  configFileStore.remove(removedFile);

  assert.equal(configFileStore.exists(removedFile), false);
  rmSync(root, { recursive: true, force: true });
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

test('argv rejects shell interpreters across supported platforms', () => {
  const parser = configRegistry.find(({ path }) => path === 'health.command').parser;

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
    assertParserFailure(
      parser,
      command,
      '$.health.command',
      (message) =>
        message.includes(`${expectedPath}: shell interpreters are forbidden`) ||
        message.includes('$.health.command[0]: unsupported executable'),
    );
});

test('argv uses bounded direct-process profiles', () => {
  const parser = configRegistry.find(({ path }) => path === 'health.command').parser;

  const validCommand = parser(['git', 'show', 'README.english'], '$.health.command');
  assert.deepEqual(validCommand, {
    ok: true,

    value: ['git', 'show', 'README.english'],
  });
  for (const command of [
    ['node', '-e', "require('node:child_process').execSync('echo unsafe')"],
    ['python', '-c', "__import__('os').system('echo unsafe')"],
    ['npm', 'exec', 'sh'],
    ['gh', 'alias', 'set', 'unsafe', '!echo unsafe'],
  ])
    assertParserFailure(parser, command, '$.health.command', (message) =>
      /unsupported executable|executable indirection is forbidden/.test(message),
    );
});

test('typed Codex configuration preserves shared options', () => {
  const config = loadConfigText(canonical);

  assert.equal(config.agents.worker.harness, 'codex');
  assert.equal(config.agents.worker.model, 'gpt-5.6-luna');
  assert.equal(config.agents.worker.sandbox, 'workspace-write');
  assert.equal(config.agents.worker.reasoningEffort, 'low');
  assert.equal(config.agents.qa.sandbox, 'workspace-write');
  assert.equal(config.agents.arbiter.sandbox, 'read-only');
});

test('sandbox configuration accepts explicit full access and rejects unknown policies', () => {
  const fullAccess = loadConfigText(canonical.replaceAll('workspace-write', 'danger-full-access'));

  assert.equal(fullAccess.agents.worker.sandbox, 'danger-full-access');
  assert.equal(fullAccess.agents.qa.sandbox, 'danger-full-access');
  assert.equal(fullAccess.agents.arbiter.sandbox, 'read-only');
  assert.throws(
    () => loadConfigText(canonical.replace('workspace-write', 'unrestricted')),
    (error) =>
      error instanceof ConfigValidationError &&
      error.message.includes('expected one of: read-only, workspace-write, danger-full-access'),
  );
});

test('argv rejects env split-string command dispatch', () => {
  const parser = configRegistry.find(({ path }) => path === 'health.command').parser;
  for (const [command, expectedPath] of [
    [['env', '-S', 'sh -c', '?'], '$.health.command[1]'],
    [['env', '-Ssh -c', '?'], '$.health.command[1]'],
    [['/usr/bin/env', '--split-string=sh -c', '?'], '$.health.command[1]'],
  ])
    assertParserFailure(parser, command, '$.health.command', (message) =>
      message.includes(`${expectedPath}: env split-string options are forbidden`),
    );
});

test('argv rejects embedded environment assignments', () => {
  const parser = configRegistry.find(({ path }) => path === 'health.command').parser;
  for (const [command, expectedPath] of [
    [['env', 'GIT_SSH_COMMAND=ssh -o ProxyCommand=helper', 'git', 'fetch'], '$.health.command[1]'],
    [['/usr/bin/env', 'GIT_CONFIG_COUNT=1', 'git', 'fetch'], '$.health.command[1]'],
    [['env', 'LD_PRELOAD=/tmp/hook.so', 'tool'], '$.health.command[1]'],
    [['env', 'NODE_OPTIONS=--require=/tmp/hook.js', 'node', 'check.mjs'], '$.health.command[1]'],
  ])
    assertParserFailure(parser, command, '$.health.command', (message) =>
      message.includes(
        `${expectedPath}: environment assignments are forbidden; inherit values from the external environment`,
      ),
    );

  assert.deepEqual(parser(['env', 'git', 'fetch'], '$.health.command'), {
    ok: true,

    value: ['env', 'git', 'fetch'],
  });
});

test('argv rejects Git configuration that dispatches a shell', () => {
  const parser = configRegistry.find(({ path }) => path === 'health.command').parser;
  for (const [command, expectedPath] of [
    [['git', '-c', 'alias.x=!echo shell-bypass', 'x'], '$.health.command[2]'],
    [['git', '-c', 'alias.x= !script', 'x'], '$.health.command[2]'],
    [['git', '-c', 'core.sshCommand=ssh-wrapper', 'fetch'], '$.health.command[2]'],
    [['git', '-c', 'core.pager=sh -c echo unsafe', '--paginate', 'log'], '$.health.command[2]'],
    [['git', '-cpager.log=unsafe-pager', '--paginate', 'log'], '$.health.command[1]'],
    [
      ['git', '--config-env', 'core.pager=SLOOP_REVIEW_PAGER', '--paginate', 'log'],
      '$.health.command[2]',
    ],
    [
      ['git', '--config-env=pager.log=SLOOP_REVIEW_PAGER', '--paginate', 'log'],
      '$.health.command[1]',
    ],
    [['git', '-c', 'filter.clean.smudge=processor', 'checkout'], '$.health.command[2]'],
  ])
    assertParserFailure(parser, command, '$.health.command', (message) =>
      message.includes(`${expectedPath}: Git configuration that dispatches a shell is forbidden`),
    );

  assert.deepEqual(parser(['git', '-c', 'fetch.prune=true', 'fetch'], '$.health.command'), {
    ok: true,

    value: ['git', '-c', 'fetch.prune=true', 'fetch'],
  });
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

for (const [credentialType, remote] of [
  ['URL credentials', 'https://x-access-token:ghp_example@example.com/org/repo.git'],
  ['a GitHub fine-grained token', 'github_pat_1234567890_example'],
  ['a GitHub token', 'ghp_1234567890example'],
]) {
  test('config parser rejects repository remotes containing ' + credentialType, () => {
    const source = createConfigWithRemote(remote);
    const parseCredentialRemote = () => loadConfigText(source);

    assert.throws(
      parseCredentialRemote,
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes('$.repository.remote: credentials are not accepted'),
    );
  });
}

test('a public remote name changes the config fingerprint', () => {
  const publicRemote = loadConfigText(createConfigWithRemote('upstream'));
  const defaultRemote = loadConfigText(canonical);
  const publicFingerprint = configFingerprint(publicRemote);
  const defaultFingerprint = configFingerprint(defaultRemote);

  assert.notEqual(publicFingerprint, defaultFingerprint);
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

test('credential carrier options are rejected even when their value is opaque', () => {
  const source = canonical.replace(
    'command:\n    # Health probe argv; never evaluated by a shell.\n    - gh\n    - run\n    - list\n    - --branch\n    - main',
    'command: [git, --credential, opaque-value]',
  );

  assert.throws(
    () => loadConfigText(source),
    (error) =>
      error instanceof ConfigValidationError &&
      error.message.includes('$.health.command[2]: credentials are not accepted'),
  );
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

test('credential-bearing headers and assignments are rejected in argv fields', () => {
  for (const [command, expectedPath] of [
    [
      ['curl', '-H', 'Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[2]',
    ],
    [['curl', '-H', 'Authorization: token opaque-secret'], '$.health.command[2]'],
    [['curl', '-H', 'Private-Token: opaque-secret'], '$.health.command[2]'],
    [['curl', '--header', 'X-Api-Key: opaque-secret'], '$.health.command[2]'],
    [['curl', '-H', 'Cookie: session=supersecret'], '$.health.command[2]'],
    [['curl', '--header=Set-Cookie: session=supersecret'], '$.health.command[1]'],
    [
      ['curl', '--header=Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[1]',
    ],
    [['curl', '--user', 'alice:supersecret', 'https://example.com'], '$.health.command[2]'],
    [['curl', '--user=alice:supersecret', 'https://example.com'], '$.health.command[1]'],
    [['tool', '--api-key', 'secret-value'], '$.health.command[2]'],
    [['tool', '--api-key=secret-value'], '$.health.command[1]'],
    [['curl', '--cookie', 'session=supersecret'], '$.health.command[2]'],
    [['curl', '--cookie=session=supersecret'], '$.health.command[1]'],
    [['curl', '-b', 'session=supersecret'], '$.health.command[2]'],
    [['curl', '-bsession=supersecret'], '$.health.command[1]'],
    [['curl', '-ualice:supersecret'], '$.health.command[1]'],
    [['curl', '-H', 'X-GitHub-Token: secret-value'], '$.health.command[2]'],
    [['curl', '-HX-Service-Key: secret-value'], '$.health.command[1]'],
    [['curl', '--header=X-Client-Secret: secret-value'], '$.health.command[1]'],
    [
      ['git', '-c', 'http.extraHeader=Authorization: Bearer secret-value', 'fetch'],
      '$.health.command[2]',
    ],
    [['curl', 'https://example.com/?access_token=secret-value'], '$.health.command[1]'],
    [['curl', '-H', 'Proxy-Authorization: Basic dXNlcjpwYXNz'], '$.health.command[2]'],
    [['tool', 'api_key=secret-value'], '$.health.command[1]'],
    [['env', 'GITHUB_TOKEN=secret-value', 'gh', 'api', 'user'], '$.health.command[1]'],
    [['tool', 'SERVICE_PASSWORD=secret-value'], '$.health.command[1]'],
    [['tool', 'sessionCookie=secret-value'], '$.health.command[1]'],
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
      `expected credential rejection for ${JSON.stringify(command)}`,
    );
  }
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

test('config path helpers return values and empty results for unknown paths', () => {
  const value = loadConfigText(canonical);
  const remoteName = configValue(value, 'repository.remote');
  const missingField = getConfigField('missing.path');
  const missingPaths = configPaths('missing.path');

  assert.equal(remoteName, 'origin');
  assert.equal(missingField, undefined);
  assert.deepEqual(missingPaths, []);
});

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

test('config parser rejects structural violations at their exact paths', () => {
  const validConfig = JSON.parse(JSON.stringify(loadConfigText(canonical)));
  const invalidConfigs = [
    [
      (value) => {
        value.schemaVersion = 2;
      },
      '$.schemaVersion',
    ],
    [
      (value) => {
        value.workflow.reviewOrder = ['worker'];
      },
      '$.workflow.reviewOrder',
    ],
    [
      (value) => {
        value.github.roleMarkers.qa = value.github.roleMarkers.worker;
      },
      '$.github.roleMarkers',
    ],
    [
      (value) => {
        value.github.labels.priority = ['p', 'p'];
      },
      '$.github.labels.priority',
    ],
    [
      (value) => {
        value.workspace.path = '';
      },
      '$.workspace.path',
    ],
    [
      (value) => {
        value.workspace.mode = 'worktree';
        value.workspace.worktreeRoot = '';
      },
      '$.workspace.worktreeRoot',
    ],
    [
      (value) => {
        value.schedule.enabled = true;
        value.schedule.expression = '';
      },
      '$.schedule.expression',
    ],
    [
      (value) => {
        value.arbiter.decisions = 0;
      },
      '$.arbiter.decisions',
    ],
  ];

  for (const [mutate, configPath] of invalidConfigs) {
    const invalidConfig = structuredClone(validConfig);
    mutate(invalidConfig);

    assert.throws(
      () => parseConfig(invalidConfig),
      (error) => error.diagnostics.some((item) => item.path === configPath),
    );
  }
});

test('config parser ignores unknown keys', () => {
  const parseWithUnknownCredentialKey = () => parseConfig({ schemaVersion: 1, token: 'secret' });

  assert.doesNotThrow(parseWithUnknownCredentialKey);
});

test('config text updates report malformed YAML', () => {
  const updateMalformedYaml = () =>
    updateConfigText('workflow: [', 'workflow.humanMergeWait', false);

  assert.throws(updateMalformedYaml, /invalid YAML/);
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

test('config file existence is a direct filesystem contract', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-exists-'));
  const file = join(root, 'sloop.config.yaml');

  assert.equal(configFileExists(file), false);
  writeFileSync(file, canonical);
  assert.equal(configFileExists(file), true);
  rmSync(root, { recursive: true, force: true });
});
