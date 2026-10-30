import {
  assert,
  test,
  ConfigValidationError,
  canonical,
  configRegistry,
  loadConfigText,
  assertParserFailure,
} from '../../support/config-test-helpers.mjs';

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
