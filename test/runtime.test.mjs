import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { test } from 'vitest';
import {
  discoverRepository as discoverRepositoryResult,
  EXIT,
  parseCliCommand as parseCliCommandResult,
  parseReadOnlyCommand as parseReadOnlyCommandResult,
  parseDispatcherCommand as parseDispatcherCommandResult,
  emitNodeVersionFailure,
  emitUsageFailure,
  resultOutput,
  runDispatcherPreflight,
  runReadOnlyCommand,
} from '../src/runtime.js';
import { canonicalConfigYaml } from '../src/config.js';

const config = canonicalConfigYaml();
const unwrap = (parsed) => {
  if (parsed.ok) return parsed.value;
  throw new Error(parsed.error);
};
const parseCliCommand = (args) => unwrap(parseCliCommandResult(args));
const parseReadOnlyCommand = (args) => unwrap(parseReadOnlyCommandResult(args));
const parseDispatcherCommand = (args) => unwrap(parseDispatcherCommandResult(args));
const discoverRepository = (io) => unwrap(discoverRepositoryResult(io));

test('CLI parsing returns a usage error result for unsupported arguments', () => {
  const unsupportedArguments = ['--unknown'];

  const parseResult = parseCliCommandResult(unsupportedArguments);

  assert.equal(parseResult.ok, false);
  assert.match(parseResult.error, /unsupported/);
});

test.each([
  [['--resolve-review-cap', '--steer'], /--steer requires a value/],
  [
    [
      '--resolve-review-cap',
      '--steer',
      'go',
      '--additional-rounds',
      '1',
      '--additional-rounds',
      '2',
    ],
    /--additional-rounds cannot be repeated/,
  ],
  [['--resolve-review-cap', '--steer', '  ', '--abandon'], /non-empty --steer/],
])('review-cap parser returns a Result for invalid value options %j', (args, expectedMessage) => {
  const parseResult = parseCliCommandResult(args);

  assert.equal(parseResult.ok, false);
  assert.match(parseResult.error, expectedMessage);
});
function createMockRuntimeHarness(overrides = {}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  const readableFiles = new Set(overrides.readableFiles ?? []);
  const responses = {
    'git rev-parse --show-toplevel': { stdout: '/repo\n', stderr: '', status: 0 },
    'git --version': { stdout: 'git version 2.50', stderr: '', status: 0 },
    'git remote get-url origin': { stdout: 'https://github.com/o/r.git', stderr: '', status: 0 },
    'git rev-parse --verify origin/main^{commit}': { stdout: 'abc', stderr: '', status: 0 },
    'git status --porcelain': { stdout: '', stderr: '', status: 0 },
    'git symbolic-ref --short HEAD': { stdout: 'codex/issue-31', stderr: '', status: 0 },
    'gh --version': { stdout: 'gh version 2', stderr: '', status: 0 },
    'gh auth status': { stdout: '', stderr: '', status: 0 },
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '{"nameWithOwner":"o/r","viewerPermission":"WRITE"}',
      stderr: '',
      status: 0,
    },
    'gh label list --repo o/r --limit 1000 --json name': {
      stdout: JSON.stringify(
        [
          'Automation Ready',
          'Automation Claimed',
          'Automation Blocked',
          'Priority: P0',
          'Priority: P1',
          'Priority: P2',
        ].map((name) => ({ name })),
      ),
      stderr: '',
      status: 0,
    },
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '[{"number":31,"title":"Discovery"}]',
        stderr: '',
        status: 0,
      },
    'codex --version': { stdout: 'codex 1', stderr: '', status: 0 },
    ...overrides,
  };
  const io = {
    cwd: '/repo/nested',
    platform: 'linux',
    nodeVersion: 'v22.1.0',
    homeDirectory: homedir(),
    run(file, args, cwd) {
      calls.push({ file, args: [...args], cwd });
      return (
        responses[`${file} ${args.join(' ')}`] ?? { stdout: '', stderr: 'unexpected', status: 1 }
      );
    },
    readFile: () => overrides.localConfig ?? config,
    canRead: (file) => readableFiles.has(file),
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  };
  return { io, calls, stdout, stderr };
}

test('command parser accepts only documented read-only forms', () => {
  const readOnlyArgs = ['status', '--verbose', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.deepEqual(parsedReadOnlyCommand, {
    command: 'status',
    json: true,
    verbose: true,
  });
  const readOnlyArgs2 = ['issues', 'list'];
  const parsedReadOnlyCommand2 = parseReadOnlyCommand(readOnlyArgs2);
  assert.deepEqual(parsedReadOnlyCommand2, {
    command: 'issues list',
    json: false,
    verbose: false,
  });
  const readOnlyArgs3 = ['doctor'];
  const parsedReadOnlyCommand3 = parseReadOnlyCommand(readOnlyArgs3);
  assert.deepEqual(parsedReadOnlyCommand3, {
    command: 'doctor',
    json: false,
    verbose: true,
  });
  const readOnlyArgs4 = ['--list'];
  const parsedReadOnlyCommand4 = parseReadOnlyCommand(readOnlyArgs4);
  assert.equal(parsedReadOnlyCommand4, undefined);
  const readOnlyArgs5 = ['doctor', '--json'];
  assert.throws(() => parseReadOnlyCommand(readOnlyArgs5), /usage:/);
  const readOnlyArgs6 = ['status', '--verbose'];
  assert.throws(() => parseReadOnlyCommand(readOnlyArgs6), /requires --json/);
});

test('JSON diagnostics are pretty-printed with stable two-space indentation', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git rev-parse --show-toplevel': { stdout: '', stderr: 'not a repository', status: 1 },
  });

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  const code = runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io);

  assert.equal(code, EXIT.preflight);
  assert.match(runtimeHarness.stdout[0], /^\{\n  "command": "status",/);
  assert.deepEqual(JSON.parse(runtimeHarness.stdout[0]).diagnostics[0].check, 'repository');
});

test('top-level parser rejects unknown argv before a dispatcher command can exist', () => {
  const cliArgs = [];
  const parsedCliCommand = parseCliCommand(cliArgs);
  assert.deepEqual(parsedCliCommand, { kind: 'dispatcher', command: { kind: 'workflow' } });
  const cliArgs2 = ['status', '--help'];
  const parsedCliCommand2 = parseCliCommand(cliArgs2);
  assert.deepEqual(parsedCliCommand2, { kind: 'help', target: 'status' });
  const cliArgs3 = ['--prepare-recovery', '--help'];
  const parsedCliCommand3 = parseCliCommand(cliArgs3);
  assert.deepEqual(parsedCliCommand3, {
    kind: 'help',
    target: '--prepare-recovery',
  });
  for (const [args, guidance] of [
    [['--list', '--help'], 'sloop issues list'],
    [['--status', '--help'], 'sloop status'],
  ])
    assert.throws(
      () => parseCliCommand(args),
      new RegExp(`no longer supported.*${guidance.replaceAll(' ', '\\s+')}`),
    );
  for (const args of [
    ['--tuvieja'],
    ['status', '--tuvieja'],
    ['issues', 'list', 'extra'],
    ['--link-issue'],
    ['--help', '--tuvieja'],
    ['status', '--verbose', '--help'],
    ['--version', '--list'],
  ])
    assert.throws(
      () => parseCliCommand(args),
      /unsupported|supported|requires|must be|usage|mixed|accepts/,
    );
});

test.each([
  [['--resolve-review-cap', '--unknown'], /unsupported command arguments/],
  [['--resolve-review-cap', '--waive-all-outstanding'], /exactly one --steer/],
  [
    ['--resolve-review-cap', '--steer', 'go', '--additional-rounds', 'many'],
    /non-negative integer/,
  ],
  [['--resolve-review-cap', '--steer', 'go', '--waive', 'Q1,invalid'], /comma-separated/],
  [['--resolve-review-cap', '--steer', 'go', '--abandon', '--waive', 'Q1'], /cannot be combined/],
  [['--resolve-review-cap', '--steer', 'go'], /choose --additional-rounds/],
])('review-cap parser rejects invalid argument form %j', (args, expectedError) => {
  assert.throws(() => parseCliCommand(args), expectedError);
});

test('CLI parser rejects mixing legacy dispatcher flags', () => {
  const cliArgs = ['--list', '--status'];

  assert.throws(() => parseCliCommand(cliArgs), /mixed, duplicate/);
});

test('human result output includes diagnostics and a read-only next action', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const diagnostic = resultOutput.createDiagnostic(
    'state',
    'The state file cannot be read.',
    'Inspect the recorded state.',
  );
  const result = resultOutput.createEnvelope(
    'status',
    'blocked',
    'result',
    'Workflow is blocked.',
    {
      nextAction: {
        command: 'sloop status --verbose',
        description: 'Inspect the recorded blocker.',
        mutates: false,
      },
    },
    [diagnostic],
  );

  const exitCode = resultOutput.emit(result, false, EXIT.blocked, runtimeHarness.io);

  assert.equal(exitCode, EXIT.blocked);
  assert.deepEqual(runtimeHarness.stderr, [
    'Workflow is blocked.\n[state] The state file cannot be read. Remediation: Inspect the recorded state.\nNext: sloop status --verbose (Inspect the recorded blocker.; read-only)',
  ]);
});

test('status blocks when readable workflow state is not a JSON object', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-state-shape-'));
  try {
    const statePath = join(root, '.sloop', 'state.json');
    mkdirSync(join(root, '.sloop'), { recursive: true });
    writeFileSync(statePath, '[]');
    const runtimeHarness = createMockRuntimeHarness({
      'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
      readableFiles: [statePath],
    });
    runtimeHarness.io.cwd = root;
    runtimeHarness.io.readFile = (file) =>
      file === statePath ? readFileSync(file, 'utf8') : config;

    const exitCode = runReadOnlyCommand(
      parseReadOnlyCommand(['status', '--json']),
      runtimeHarness.io,
    );

    assert.equal(exitCode, EXIT.blocked);
    const result = JSON.parse(runtimeHarness.stdout[0]);
    assert.equal(result.status, 'blocked');
    assert.equal(result.diagnostics[0].check, 'state');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issues list reports a GitHub command failure as an external diagnostic', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '',
        stderr: 'network unavailable',
        status: 1,
      },
  });
  const parsedCommand = parseReadOnlyCommand(['issues', 'list', '--json']);

  const exitCode = runReadOnlyCommand(parsedCommand, runtimeHarness.io);

  assert.equal(exitCode, EXIT.external);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostics[0].check, 'github');
  assert.match(result.diagnostics[0].message, /did not return issues/);
});

test('issues list reports malformed GitHub JSON as an external diagnostic', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '{invalid',
        stderr: '',
        status: 0,
      },
  });
  const parsedCommand = parseReadOnlyCommand(['issues', 'list', '--json']);

  const exitCode = runReadOnlyCommand(parsedCommand, runtimeHarness.io);

  assert.equal(exitCode, EXIT.external);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostics[0].check, 'github');
  assert.match(result.diagnostics[0].message, /could not be parsed/);
});

test('dispatcher parser defaults to the workflow command', () => {
  const dispatcherArgs = [];
  const expectedCommand = { kind: 'workflow' };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser accepts a complete recovery command', () => {
  const dispatcherArgs = ['--prepare-recovery', '31', '--pr', '54'];
  const expectedCommand = {
    kind: 'prepare-recovery',
    issue: 31,
    pr: 54,
  };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser accepts review cap options', () => {
  const dispatcherArgs = [
    '--resolve-review-cap',
    '--steer',
    'continue',
    '--additional-rounds',
    '1',
    '--waive',
    'S1,Q2',
  ];
  const expectedCommand = {
    kind: 'resolve-review-cap',
    options: {
      steer: 'continue',
      additionalRounds: 1,
      waivedFindingIds: ['S1', 'Q2'],
      waiveAllOutstanding: false,
      abandon: false,
    },
  };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser rejects mixed, unsupported, and duplicate commands', () => {
  const dispatcherArgs = ['--prepare-recovery', '31', '--link-issue', '32'];
  assert.throws(
    () => parseDispatcherCommand(dispatcherArgs),
    /mixed, duplicate, unknown, or unsupported/,
  );
  const dispatcherArgs2 = ['--repo', 'owner/other'];
  assert.throws(() => parseDispatcherCommand(dispatcherArgs2), /unsupported/);
  const dispatcherArgs3 = ['--list', '--list'];
  assert.throws(() => parseDispatcherCommand(dispatcherArgs3), /duplicate/);
});
test('repository discovery uses the invocation cwd and normalizes one Git root', () => {
  const runtimeHarness = createMockRuntimeHarness();

  assert.equal(discoverRepository(runtimeHarness.io), resolve('/repo'));
  assert.equal(runtimeHarness.calls[0].cwd, '/repo/nested');
  assert.deepEqual(runtimeHarness.calls[0].args, ['rev-parse', '--show-toplevel']);
});

test('repository discovery rejects a Git-selected worktree that does not contain the invocation', () => {
  const runtimeHarness = createMockRuntimeHarness();
  runtimeHarness.io.cwd = resolve('/outside');

  const discoveryResult = discoverRepositoryResult(runtimeHarness.io);
  assert.equal(discoveryResult.ok, false);
  assert.equal(discoveryResult.error.check, 'repository');
  assert.match(discoveryResult.error.message, /does not contain/);
});

test('dispatcher preflight emits a typed discovery diagnostic when Git cannot find a repository', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git rev-parse --show-toplevel': { stdout: '', stderr: 'not a repository', status: 1 },
  });
  const dispatcherCommand = parseDispatcherCommand(['--list']);

  const preflightResult = runDispatcherPreflight(dispatcherCommand, runtimeHarness.io);

  assert.equal(preflightResult.code, EXIT.preflight);
  assert.match(runtimeHarness.stderr[0], /current directory is not inside a Git repository/);
  assert.equal(
    runtimeHarness.calls.some(({ file, args }) => file === 'git' && args[0] === 'remote'),
    false,
  );
});

test('workflow dispatcher preflight runs the full doctor prerequisite set', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const workflowCommand = { kind: 'workflow' };

  const preflightResult = runDispatcherPreflight(workflowCommand, runtimeHarness.io);

  assert.equal(preflightResult.code, EXIT.preflight);
  assert.ok(
    runtimeHarness.calls.some(({ file, args }) => file === 'codex' && args[0] === '--version'),
  );
  assert.ok(runtimeHarness.calls.some(({ file, args }) => file === 'git' && args[0] === 'status'));
});

test('outside a repository is a preflight failure on stderr without later calls', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git rev-parse --show-toplevel': { stdout: '', stderr: 'no repo', status: 128 },
  });

  const readOnlyArgs = ['status'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.preflight);
  assert.equal(runtimeHarness.stdout.length, 0);
  assert.match(runtimeHarness.stderr[0], /not inside a Git repository.*Remediation:/s);
  assert.equal(runtimeHarness.calls.length, 1);
});

test('JSON failure is one envelope on stdout with no stderr noise', () => {
  const runtimeHarness = createMockRuntimeHarness({ localConfig: 'schemaVersion: [' });

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.preflight);
  assert.equal(runtimeHarness.stderr.length, 0);
  assert.equal(runtimeHarness.stdout.length, 1);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.deepEqual(Object.keys(result), [
    'command',
    'status',
    'phase',
    'summary',
    'result',
    'diagnostics',
    'references',
  ]);
  assert.equal(result.diagnostics[0].check, 'configuration');
});

test('status is read-only, loads local configuration, and skips GitHub', () => {
  const runtimeHarness = createMockRuntimeHarness();

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.ok);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.equal(result.status, 'idle');
  assert.equal(result.result.repository, resolve('/repo'));
  assert.equal(result.result.configRef, 'working-tree');
  assert.ok(!runtimeHarness.calls.some(({ file }) => file === 'gh'));
  assert.ok(
    !runtimeHarness.calls.some(({ args }) =>
      ['fetch', 'checkout', 'reset', 'clean'].includes(args[0]),
    ),
  );
});

test('issues list validates relevant GitHub prerequisites and returns references', () => {
  const runtimeHarness = createMockRuntimeHarness();

  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.ok);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.deepEqual(result.references.issues, [31]);
  assert.equal(result.result.issues[0].title, 'Discovery');
});

test('preflight aggregates safely evaluable failures', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh auth status': { stdout: '', stderr: '', status: 1 },
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '',
      stderr: '',
      status: 1,
    },
    'gh label list --repo o/r --limit 1000 --json name': { stdout: '[]', stderr: '', status: 0 },
  });

  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.preflight);
  const checks = JSON.parse(runtimeHarness.stdout[0]).diagnostics.map(({ check }) => check);
  assert.deepEqual(checks, ['github-auth', 'repository-identity', 'labels']);
  assert.ok(!runtimeHarness.calls.some(({ args }) => args[0] === 'issue'));
});

test('external service failure uses exit 5 and never reports success', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '',
        stderr: 'network',
        status: 1,
      },
  });

  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.external);
  assert.equal(JSON.parse(runtimeHarness.stdout[0]).status, 'failed');
});

test('all stable exit-code classes are distinct and documented', () => {
  assert.deepEqual(EXIT, { ok: 0, preflight: 2, busy: 3, blocked: 4, external: 5 });
});

test('public status result boundary emits blocked JSON and exit 4 for unreadable state', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-blocked-status-'));

  try {
    mkdirSync(join(root, '.sloop'));
    writeFileSync(join(root, '.sloop', 'state.json'), '{invalid');
    const runtimeHarness = createMockRuntimeHarness({
      'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
      readableFiles: [join(root, '.sloop', 'state.json')],
    });
    runtimeHarness.io.cwd = root;
    const readOnlyArgs = ['status', '--json'];
    const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.blocked);
    assert.equal(runtimeHarness.stderr.length, 0);
    assert.equal(runtimeHarness.stdout.length, 1);
    const result = JSON.parse(runtimeHarness.stdout[0]);
    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'result');
    assert.equal(result.diagnostics[0].check, 'state');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher commands cross discovery and base-config preflight before operations', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const dispatcherArgs = ['--status'];
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const result = runDispatcherPreflight(parsedDispatcherCommand, runtimeHarness.io);

  assert.equal(result.code, EXIT.ok);
  assert.equal(result.root, resolve('/repo'));
  assert.equal(result.repository, 'o/r');
  assert.equal(result.config.repository.baseBranch, 'main');
  assert.deepEqual(
    runtimeHarness.calls.slice(0, 3).map(({ file, args }) => `${file} ${args.join(' ')}`),
    ['git rev-parse --show-toplevel', 'git --version', 'git remote get-url origin'],
  );
});

test('dispatcher preflight failure stops before any mutation-capable dependency', () => {
  const runtimeHarness = createMockRuntimeHarness({ localConfig: 'schemaVersion: [' });
  const result = runDispatcherPreflight([], runtimeHarness.io);

  assert.deepEqual(result, { code: EXIT.preflight });
  assert.match(runtimeHarness.stderr[0], /configuration/);
  assert.ok(!runtimeHarness.calls.some(({ file }) => file === 'gh'));
  assert.ok(
    !runtimeHarness.calls.some(({ args }) => ['status', 'checkout', 'reset'].includes(args[0])),
  );
});

test('local recovery commands do not require GitHub, Codex, labels, or a clean tree', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git status --porcelain': { stdout: 'dirty', stderr: '', status: 0 },
    'gh --version': { stdout: '', stderr: 'missing', status: 1 },
    'codex --version': { stdout: '', stderr: 'missing', status: 1 },
  });
  const dispatcherArgs = ['--prepare-recovery', '31', '--pr', '54'];
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const result = runDispatcherPreflight(parsedDispatcherCommand, runtimeHarness.io);

  assert.equal(result.code, EXIT.ok);
  assert.ok(!runtimeHarness.calls.some(({ file }) => file === 'gh' || file === 'codex'));
  assert.ok(
    !runtimeHarness.calls.some(({ args }) => args[0] === 'status' || args[0] === 'symbolic-ref'),
  );
});

test('ambiguous dispatcher command fails before discovery or mutation prerequisites', () => {
  const runtimeHarness = createMockRuntimeHarness();

  const dispatcherArgs = ['--prepare-recovery', '31', '--link-issue', '32'];
  assert.throws(() => parseDispatcherCommand(dispatcherArgs));
  assert.equal(runtimeHarness.calls.length, 0);
});

test('missing configured remote is collected as a preflight diagnostic', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git remote get-url origin': { stdout: '', stderr: 'missing', status: 2 },
  });

  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.preflight);
  const checks = JSON.parse(runtimeHarness.stdout[0]).diagnostics.map(({ check }) => check);
  assert.ok(checks.includes('remote'));
});

test('local configuration controls the base branch selector', () => {
  const redirected = canonicalConfigYaml().replace(
    '    # Pull-request target and healthy base branch.\n    main',
    '    # Pull-request target and healthy base branch.\n    trunk',
  );
  const runtimeHarness = createMockRuntimeHarness({
    localConfig: redirected,
    'git rev-parse --verify origin/trunk^{commit}': { stdout: 'abc', stderr: '', status: 0 },
  });

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.ok);
  assert.equal(JSON.parse(runtimeHarness.stdout[0]).result.configRef, 'working-tree');
});

test('runtime diagnostics cover unavailable tools, malformed GitHub responses, and every read-only result', () => {
  const cases = [
    [{ 'gh --version': { stdout: '', stderr: '', status: 1 } }, ['issues', 'list', '--json'], 'gh'],
    [
      {
        'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
          stdout: '{',
          stderr: '',
          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'repository-identity',
    ],
    [
      {
        'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
          stdout: '{"viewerPermission":"READ"}',
          stderr: '',
          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'repository-identity',
    ],
    [
      {
        'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
          stdout: '{"nameWithOwner":"o/r","viewerPermission":"NONE"}',
          stderr: '',
          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'permissions',
    ],
    [
      {
        'gh label list --repo o/r --limit 1000 --json name': { stdout: '{', stderr: '', status: 0 },
      },
      ['issues', 'list', '--json'],
      'labels',
    ],
    [
      {
        'gh label list --repo o/r --limit 1000 --json name': {
          stdout: '[]',
          stderr: '',
          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'labels',
    ],
    [
      {
        'gh label list --repo o/r --limit 1000 --json name': { stdout: '', stderr: '', status: 1 },
      },
      ['issues', 'list', '--json'],
      'permissions',
    ],
  ];

  for (const [overrides, args, check] of cases) {
    const runtimeHarness = createMockRuntimeHarness(overrides);
    const parsedReadOnlyCommand = parseReadOnlyCommand(args);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.preflight);
    assert.ok(
      JSON.parse(runtimeHarness.stdout[0]).diagnostics.some((item) => item.check === check),
    );
  }
  for (const [stdout, expected] of [
    ['not json', EXIT.external],
    ['[]', EXIT.ok],
  ]) {
    const runtimeHarness = createMockRuntimeHarness({
      'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
        { stdout, stderr: '', status: 0 },
    });
    const readOnlyArgs = ['issues', 'list', '--json'];
    const parsedReadOnlyCommand2 = parseReadOnlyCommand(readOnlyArgs);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand2, runtimeHarness.io), expected);
  }
});

test('dispatcher parser accepts every supported control command family', () => {
  for (const args of [
    ['--list'],
    ['--recover-lock'],
    ['--reset'],
    ['--list-all-worktrees'],
    ['--clear-all-worktrees'],
    ['--link-issue', '1'],
    ['--resolve-review-cap', '--steer', 'go', '--waive-all-outstanding'],
    ['--resolve-review-cap', '--steer', 'go', '--abandon'],
  ])
    assert.doesNotThrow(() => parseDispatcherCommand(args));
});

test('CLI parser accepts supported read-only and configuration commands', () => {
  for (const args of [
    ['status', '--verbose', '--json'],
    ['issues', 'list', '--json'],
    ['doctor'],
    ['config', 'install', '--force'],
    ['config', 'x'],
  ])
    assert.doesNotThrow(() => parseCliCommand(args));
});

test('dispatcher preflight reports an invalid GitHub repository URL', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git remote get-url origin': { stdout: 'not-a-github-url', stderr: '', status: 0 },
  });
  const dispatcherArgs = ['--status'];
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  assert.equal(
    runDispatcherPreflight(parsedDispatcherCommand, runtimeHarness.io).code,
    EXIT.preflight,
  );
});

test('node-version failure emits JSON diagnostics when requested', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const output = [];
  const errors = [];

  assert.equal(
    emitNodeVersionFailure(['status', '--json'], 'v1.0.0', {
      ...runtimeHarness.io,
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
    }),
    EXIT.preflight,
  );
  assert.equal(JSON.parse(output[0]).diagnostics[0].check, 'node');
  assert.deepEqual(errors, []);
});

test('node-version failure explains the minimum version in human output', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const output = [];
  const errors = [];

  assert.equal(
    emitNodeVersionFailure(['status'], 'v1.0.0', {
      ...runtimeHarness.io,
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
    }),
    EXIT.preflight,
  );
  assert.equal(output.length, 0);
  assert.match(errors[0], /Node.js 22/);
});

test('usage failure returns the preflight exit code', () => {
  const exitCode = emitUsageFailure(['--json'], 'bad input');

  assert.equal(exitCode, EXIT.preflight);
});

test('status uses production IO from the repository and fails outside it', () => {
  const original = process.cwd();
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-production-io-'));

  try {
    const production = createMockRuntimeHarness();
    const readOnlyArgs = ['status', '--json'];
    const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, production.io), EXIT.ok);
    process.chdir(outside);
    const readOnlyArgs2 = ['status', '--json'];
    const parsedReadOnlyCommand2 = parseReadOnlyCommand(readOnlyArgs2);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand2), EXIT.preflight);
  } finally {
    process.chdir(original);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('doctor reports every failed prerequisite in one diagnostic response', () => {
  const doctor = createMockRuntimeHarness({
    'git --version': { stdout: '', stderr: '', status: 1 },
    'git remote get-url origin': { stdout: '', stderr: '', status: 1 },
    'git rev-parse --verify origin/main^{commit}': { stdout: '', stderr: '', status: 1 },
    'gh --version': { stdout: '', stderr: '', status: 1 },
    'codex --version': { stdout: '', stderr: '', status: 1 },
    'git status --porcelain': { stdout: '', stderr: '', status: 1 },
    'git symbolic-ref --short HEAD': { stdout: '', stderr: '', status: 1 },
  });
  doctor.io.platform = 'freebsd';
  doctor.io.nodeVersion = 'unknown';
  const readOnlyArgs = ['doctor'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, doctor.io), EXIT.preflight);
  const checks = doctor.stderr[0];
  for (const check of [
    'platform',
    'node',
    'git',
    'remote',
    'base-branch',
    'gh',
    'codex',
    'skills',
    'working-tree',
    'branch-policy',
  ])
    assert.match(checks, new RegExp(`\\[${check}\\]`));
});

test('dispatcher preflight rejects every command when local configuration is malformed', () => {
  const invalid = createMockRuntimeHarness({ localConfig: 'schemaVersion: [' });
  for (const command of [
    { kind: 'workflow' },
    { kind: 'list' },
    { kind: 'recover-lock' },
    { kind: 'reset' },
    { kind: 'prepare-recovery', issue: 1 },
    {
      kind: 'resolve-review-cap',
      options: {
        steer: 'x',
        additionalRounds: 0,
        waivedFindingIds: [],
        waiveAllOutstanding: true,
        abandon: false,
      },
    },
    { kind: 'link-issue', issue: 1 },
    { kind: 'list-all-worktrees' },
    { kind: 'clear-all-worktrees' },
    { kind: 'status', verbose: false },
  ])
    assert.equal(runDispatcherPreflight(command, invalid.io).code, EXIT.preflight);
});

test.each([
  ['blocked', EXIT.blocked],
  ['running', EXIT.ok],
  ['complete', EXIT.ok],
])('status reports the expected exit code for %s state', (status, expected) => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-runtime-state-'));
  mkdirSync(join(root, '.sloop'));
  writeFileSync(join(root, '.sloop', 'state.json'), JSON.stringify({ status, issue: 7, pr: 8 }));
  const runtimeHarness = createMockRuntimeHarness({
    'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
    readableFiles: [join(root, '.sloop', 'state.json')],
  });
  runtimeHarness.io.cwd = root;
  runtimeHarness.io.readFile = (file) =>
    file.endsWith(join('.sloop', 'state.json')) ? readFileSync(file, 'utf8') : config;

  const statusArgs = ['status', '--json'];
  const verboseStatusArgs = ['status', '--verbose', '--json'];
  const statusCommand = parseReadOnlyCommand(statusArgs);
  const verboseStatusCommand = parseReadOnlyCommand(verboseStatusArgs);
  const statusExitCode = runReadOnlyCommand(statusCommand, runtimeHarness.io);
  const verboseStatusExitCode = runReadOnlyCommand(verboseStatusCommand, runtimeHarness.io);

  assert.equal(statusExitCode, expected);
  assert.equal(verboseStatusExitCode, expected);
});

test('CLI config init and install map to distinct dispatcher commands', () => {
  const cliArgs = ['config', 'init', '--wizard'];
  const parsedCliCommand = parseCliCommand(cliArgs);
  const initCommand = parsedCliCommand;
  const cliArgs2 = ['config', 'install', '--force'];
  const parsedCliCommand2 = parseCliCommand(cliArgs2);
  const installCommand = parsedCliCommand2;

  assert.deepEqual(initCommand, {
    kind: 'config',
    args: ['--init', '--wizard'],
  });
  assert.deepEqual(installCommand, {
    kind: 'config',
    args: ['--install', '--force'],
  });
  const cliArgs3 = ['config', 'init', '--force'];
  assert.throws(() => parseCliCommand(cliArgs3), /usage/);
  const cliArgs4 = ['config', 'install', '--wizard'];
  assert.throws(() => parseCliCommand(cliArgs4), /usage/);
});

test('dispatcher preflight accepts each GitHub write command family', () => {
  const dispatcherArgs3 = [
    '--resolve-review-cap',
    '--steer',
    'continue',
    '--waive-all-outstanding',
  ];
  const dispatcherArgs2 = ['--link-issue', '9'];
  const dispatcherArgs = ['--list'];
  const parsedDispatcherCommand3 = parseDispatcherCommand(dispatcherArgs3);
  const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  for (const command of [
    parsedDispatcherCommand,
    parsedDispatcherCommand2,
    parsedDispatcherCommand3,
  ]) {
    const runtimeHarness = createMockRuntimeHarness();
    assert.equal(runDispatcherPreflight(command, runtimeHarness.io).code, EXIT.ok);
  }
});

test('issues list rejects a remote URL outside GitHub', () => {
  const badRemote = createMockRuntimeHarness({
    'git remote get-url origin': {
      stdout: 'https://example.test/not-github',
      stderr: '',
      status: 0,
    },
  });
  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, badRemote.io), EXIT.preflight);
  assert.equal(JSON.parse(badRemote.stdout[0]).diagnostics.at(-1).check, 'repository-identity');
});

test('issues list reports a remote that changes to a non-GitHub URL after preflight', () => {
  const runtimeHarness = createMockRuntimeHarness();
  const originalRun = runtimeHarness.io.run;
  let remoteLookupCount = 0;
  runtimeHarness.io.run = (file, args, cwd) => {
    if (file === 'git' && args.join(' ') === 'remote get-url origin') {
      remoteLookupCount += 1;
      if (remoteLookupCount === 3) {
        return { stdout: 'https://example.test/not-github', stderr: '', status: 0 };
      }
    }
    return originalRun(file, args, cwd);
  };
  const readOnlyCommand = parseReadOnlyCommand(['issues', 'list', '--json']);

  const exitCode = runReadOnlyCommand(readOnlyCommand, runtimeHarness.io);

  assert.equal(exitCode, EXIT.preflight);
  assert.equal(JSON.parse(runtimeHarness.stdout[0]).diagnostics[0].check, 'repository-identity');
  assert.equal(remoteLookupCount, 3);
});

test('doctor rejects a branch that violates the configured branch policy', () => {
  const branch = createMockRuntimeHarness({
    'git symbolic-ref --short HEAD': { stdout: 'feature/nope', stderr: '', status: 0 },
  });
  const readOnlyArgs = ['doctor'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, branch.io), EXIT.preflight);
  assert.match(branch.stderr[0], /Branch feature\/nope violates/);
});

test('runtime reports missing configuration and dispatcher validation failures after discovery', () => {
  const missing = createMockRuntimeHarness();
  missing.io.readFile = () => {
    throw new Error('missing');
  };

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, missing.io), EXIT.preflight);
  assert.equal(JSON.parse(missing.stdout[0]).diagnostics[0].check, 'configuration');
  const invalid = createMockRuntimeHarness({
    'git remote get-url origin': { stdout: '', stderr: 'missing', status: 1 },
  });
  const dispatcherArgs = ['--status'];
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  assert.equal(runDispatcherPreflight(parsedDispatcherCommand, invalid.io).code, EXIT.preflight);
});

test('runtime reports malformed repository identity and label payloads', () => {
  const identity = createMockRuntimeHarness({
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '{',
      stderr: '',
      status: 0,
    },
    'gh label list --repo o/r --limit 1000 --json name': {
      stdout: '{',
      stderr: '',
      status: 0,
    },
  });

  const readOnlyArgs = ['issues', 'list'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, identity.io), EXIT.preflight);
  assert.ok(identity.calls.some(({ file, args }) => file === 'gh' && args[0] === 'repo'));
  assert.ok(identity.calls.some(({ file, args }) => file === 'gh' && args[0] === 'label'));
});

test('read-only diagnostics provide safe guidance for every inspection failure', () => {
  const cases = [
    [
      {
        'gh label list --repo o/r --limit 1000 --json name': {
          stdout: '[]',
          stderr: '',
          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'labels',
    ],
    [
      { 'git status --porcelain': { stdout: '', stderr: 'cannot inspect', status: 1 } },
      ['doctor'],
      'working-tree',
    ],
    [{ 'codex --version': { stdout: '', stderr: 'missing', status: 1 } }, ['doctor'], 'codex'],
    [{ localConfig: 'schemaVersion: [' }, ['status', '--json'], 'configuration'],
  ];

  for (const [overrides, args, check] of cases) {
    const runtimeHarness = createMockRuntimeHarness(overrides);
    const parsedReadOnlyCommand = parseReadOnlyCommand(args);
    runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io);
    const output = args.includes('--json') ? runtimeHarness.stdout[0] : runtimeHarness.stderr[0];
    const result = args.includes('--json') ? JSON.parse(output) : undefined;
    const item = result?.diagnostics?.find((diagnostic) => diagnostic.check === check);
    if (item) {
      assert.equal(item.mutates, false);
      assert.equal(item.nextAction.mutates, false);
      assert.equal(item.nextAction.command, 'sloop doctor');
      assert.match(item.nextAction.description, /read-only|safe repair command/);
    } else assert.match(output, new RegExp(`\\[${check}\\]`));
    assert.ok(
      !runtimeHarness.calls.some(({ args: commandArgs }) =>
        ['checkout', 'reset', 'clean', 'push'].includes(commandArgs[0]),
      ),
    );
  }
});

test('status recovery guidance remains safe and contextual when issue or PR data is absent', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-recovery-guidance-'));

  try {
    mkdirSync(join(root, '.sloop'));
    writeFileSync(join(root, '.sloop', 'state.json'), JSON.stringify({ status: 'ci_failed' }));
    const runtimeHarness = createMockRuntimeHarness({
      'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
      readableFiles: [join(root, '.sloop', 'state.json')],
    });
    runtimeHarness.io.cwd = root;
    runtimeHarness.io.readFile = (file) =>
      file.endsWith(join('.sloop', 'state.json')) ? readFileSync(file, 'utf8') : config;
    const readOnlyArgs = ['status', '--json'];
    const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.ok);
    const result = JSON.parse(runtimeHarness.stdout[0]);
    assert.deepEqual(result.result.nextAction, {
      command: 'sloop status --verbose',
      description: 'Inspect the recovery state; issue or PR context is unavailable.',
      mutates: false,
    });
    assert.ok(!runtimeHarness.calls.some(({ file }) => file === 'gh'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status diagnoses every recovery observation with contextual safe guidance', () => {
  const observations = [
    ['leaseActive', 'lease', 'Another dispatcher owns an active run lease.'],
    ['blockedPhase', 'blocked', 'The remote workflow phase is blocked.'],
    ['artifactMissing', 'artifact', 'The expected run artifact is absent.'],
    ['configStale', 'configuration', 'The recorded configuration fingerprint is stale.'],
    ['checkoutDirty', 'checkout', 'The checkout has uncommitted changes.'],
    ['checksFailed', 'checks', 'One or more required PR checks failed.'],
    ['prClosedUnmerged', 'pull request', 'The pull request is closed but not merged.'],
    ['schedulerDrift', 'scheduler', 'The scheduler configuration or heartbeat has drifted.'],
  ];
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-recovery-matrix-'));

  try {
    mkdirSync(join(root, '.sloop'));
    for (const [flag, phase, blocker] of observations) {
      writeFileSync(
        join(root, '.sloop', 'state.json'),
        JSON.stringify({ status: 'ci_failed', issue: 45, pr: 107, [flag]: true }),
      );
      const runtimeHarness = createMockRuntimeHarness({
        'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
        readableFiles: [join(root, '.sloop', 'state.json')],
      });
      runtimeHarness.io.cwd = root;
      runtimeHarness.io.readFile = (file) =>
        file.endsWith(join('.sloop', 'state.json')) ? readFileSync(file, 'utf8') : config;

      const readOnlyArgs = ['status', '--json'];
      const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
      assert.equal(
        runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io),
        EXIT.ok,
        `status should inspect ${flag}`,
      );
      const diagnostic = JSON.parse(runtimeHarness.stdout[0]).diagnostics.find(
        (item) => item.check === `recovery-${phase}`,
      );
      assert.deepEqual(diagnostic, {
        check: `recovery-${phase}`,
        message: `${blocker} (issue #45, PR #107)`,
        remediation:
          'Next: sloop --prepare-recovery 45 --pr 107; this mutates local recovery state.',
        phase,
        context: { issue: 45, pullRequest: 107 },
        nextAction: {
          command: 'sloop --prepare-recovery 45 --pr 107',
          description: 'Prepare the recorded recovery for the issue and pull request.',
          mutates: true,
        },
        mutates: false,
      });
      assert.equal(
        runtimeHarness.calls.some(
          ({ file, args }) =>
            file === 'gh' || ['checkout', 'reset', 'clean', 'push'].includes(args[0]),
        ),
        false,
        `${flag} diagnosis must not mutate local or remote state`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic commands remain read-only across local, GitHub, and scheduler boundaries', () => {
  const forbidden = new Set(['checkout', 'reset', 'clean', 'push', 'schedule', 'workflow']);

  for (const args of [['status', '--json'], ['issues', 'list', '--json'], ['doctor']]) {
    const runtimeHarness = createMockRuntimeHarness();
    const originalReadFile = runtimeHarness.io.readFile;
    let writes = 0;
    runtimeHarness.io.readFile = (...readArgs) => originalReadFile(...readArgs);
    runtimeHarness.io.writeFile = () => {
      writes += 1;
      throw new Error('diagnostic attempted a write');
    };
    const parsedReadOnlyCommand = parseReadOnlyCommand(args);
    runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io);
    assert.equal(writes, 0, `${args.join(' ')} must not write local state`);
    assert.equal(
      runtimeHarness.calls.some(({ file, args: commandArgs }) =>
        file === 'gh' && ['pr', 'issue', 'label', 'repo', 'auth'].includes(commandArgs[0])
          ? commandArgs.some((arg) => ['close', 'edit', 'merge', 'delete', 'create'].includes(arg))
          : forbidden.has(commandArgs[0]),
      ),
      false,
      `${args.join(' ')} must not mutate remote state or scheduler`,
    );
  }
});

test('issues list normalizes GitHub labels and selects configured priorities', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: JSON.stringify([
          { number: 42, title: 'Prioritized', labels: [{ name: 'Priority: P0' }] },
          { number: 43, title: 'Unprioritized', labels: [{ name: 'Automation Ready' }] },
        ]),
        stderr: '',
        status: 0,
      },
  });
  const parsedCommand = parseReadOnlyCommand(['issues', 'list', '--json']);

  const exitCode = runReadOnlyCommand(parsedCommand, runtimeHarness.io);

  assert.equal(exitCode, EXIT.ok);
  const result = JSON.parse(runtimeHarness.stdout[0]);
  assert.deepEqual(
    result.result.issues.map(({ number }) => number),
    [42, 43],
  );
});

test('runtime reports insufficient permissions and missing doctor skills', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '{"nameWithOwner":"o/r","viewerPermission":"READ"}',
      stderr: '',
      status: 0,
    },
  });

  const dispatcherArgs = ['--link-issue', '1'];
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  assert.equal(
    runDispatcherPreflight(parsedDispatcherCommand, runtimeHarness.io).code,
    EXIT.preflight,
  );
});
test('doctor includes a bounded executable failure status and output', () => {
  const diagnosticOutput = 'x'.repeat(250);
  const runtimeHarness = createMockRuntimeHarness({
    'codex --version': { stdout: '', stderr: diagnosticOutput, status: 37 },
  });
  const parsedDoctorCommand = parseReadOnlyCommand(['doctor']);

  runReadOnlyCommand(parsedDoctorCommand, runtimeHarness.io);

  const diagnostic = runtimeHarness.stderr.find((line) => line.includes('[codex]'));
  assert.match(diagnostic, /exit status 37/);
  assert.ok(diagnostic.includes('x'.repeat(200)));
  assert.ok(!diagnostic.includes('x'.repeat(201)));
});
