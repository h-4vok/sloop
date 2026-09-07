import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  discoverRepository,
  EXIT,
  parseReadOnlyCommand,
  parseDispatcherCommand,
  runDispatcherPreflight,
  runReadOnlyCommand,
} from '../dist/runtime.js';
import { canonicalConfigYaml } from '../dist/config.js';

const config = canonicalConfigYaml();
function harness(overrides = {}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  const responses = {
    'git rev-parse --show-toplevel': { stdout: '/repo\n', stderr: '', status: 0 },
    'git show HEAD:sloop.config.yaml': { stdout: config, stderr: '', status: 0 },
    'git show origin/main:sloop.config.yaml': { stdout: config, stderr: '', status: 0 },
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
    run(file, args, cwd) {
      calls.push({ file, args: [...args], cwd });
      return (
        responses[`${file} ${args.join(' ')}`] ?? { stdout: '', stderr: 'unexpected', status: 1 }
      );
    },
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  };
  return { io, calls, stdout, stderr };
}

test('command parser accepts only documented read-only forms', () => {
  assert.deepEqual(parseReadOnlyCommand(['status', '--verbose', '--json']), {
    command: 'status',
    json: true,
    verbose: true,
  });
  assert.deepEqual(parseReadOnlyCommand(['issues', 'list']), {
    command: 'issues list',
    json: false,
    verbose: false,
  });
  assert.deepEqual(parseReadOnlyCommand(['doctor']), {
    command: 'doctor',
    json: false,
    verbose: true,
  });
  assert.equal(parseReadOnlyCommand(['--list']), undefined);
  assert.throws(() => parseReadOnlyCommand(['doctor', '--json']), /usage:/);
});

test('dispatcher parser accepts one complete command and rejects ambiguous or unsupported forms', () => {
  assert.deepEqual(parseDispatcherCommand([]), { kind: 'workflow' });
  assert.deepEqual(parseDispatcherCommand(['--prepare-recovery', '31', '--pr', '54']), {
    kind: 'prepare-recovery',
  });
  assert.throws(
    () => parseDispatcherCommand(['--prepare-recovery', '31', '--link-issue', '32']),
    /mixed, duplicate, unknown, or unsupported/,
  );
  assert.throws(() => parseDispatcherCommand(['--repo', 'owner/other']), /unsupported/);
  assert.throws(() => parseDispatcherCommand(['--list', '--list']), /duplicate/);
  assert.deepEqual(
    parseDispatcherCommand([
      '--resolve-review-cap',
      '--steer',
      'continue',
      '--additional-rounds',
      '1',
      '--waive',
      'S1,Q2',
    ]),
    { kind: 'resolve-review-cap' },
  );
  for (const tail of [
    ['--help'],
    ['--version'],
    ['--json'],
    ['--unknown'],
    ['--steer', 'again'],
    ['--additional-rounds', '1', '--additional-rounds', '2'],
  ])
    assert.throws(() =>
      parseDispatcherCommand(['--resolve-review-cap', '--steer', 'continue', ...tail]),
    );
});

test('repository discovery uses the invocation cwd and normalizes one Git root', () => {
  const h = harness();
  assert.equal(discoverRepository(h.io), resolve('/repo'));
  assert.equal(h.calls[0].cwd, '/repo/nested');
  assert.deepEqual(h.calls[0].args, ['rev-parse', '--show-toplevel']);
});

test('repository discovery rejects a Git-selected worktree that does not contain the invocation', () => {
  const h = harness();
  h.io.cwd = resolve('/outside');
  assert.throws(
    () => discoverRepository(h.io),
    (error) => error.check === 'repository' && /does not contain/.test(error.message),
  );
});

test('outside a repository is a preflight failure on stderr without later calls', () => {
  const h = harness({
    'git rev-parse --show-toplevel': { stdout: '', stderr: 'no repo', status: 128 },
  });
  assert.equal(runReadOnlyCommand(parseReadOnlyCommand(['status']), h.io), EXIT.preflight);
  assert.equal(h.stdout.length, 0);
  assert.match(h.stderr[0], /not inside a Git repository.*Remediation:/s);
  assert.equal(h.calls.length, 1);
});

test('JSON failure is one envelope on stdout with no stderr noise', () => {
  const h = harness({
    'git show origin/main:sloop.config.yaml': { stdout: '', stderr: 'missing', status: 128 },
  });
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['status', '--json']), h.io),
    EXIT.preflight,
  );
  assert.equal(h.stderr.length, 0);
  assert.equal(h.stdout.length, 1);
  const result = JSON.parse(h.stdout[0]);
  assert.deepEqual(Object.keys(result), [
    'command',
    'status',
    'phase',
    'summary',
    'result',
    'diagnostics',
    'references',
  ]);
  assert.equal(result.diagnostics[0].check, 'base-configuration');
});

test('status is read-only, loads configuration from the configured base, and skips GitHub', () => {
  const h = harness();
  assert.equal(runReadOnlyCommand(parseReadOnlyCommand(['status', '--json']), h.io), EXIT.ok);
  const result = JSON.parse(h.stdout[0]);
  assert.equal(result.status, 'idle');
  assert.equal(result.result.repository, resolve('/repo'));
  assert.equal(result.result.configRef, 'origin/main');
  assert.ok(!h.calls.some(({ file }) => file === 'gh'));
  assert.ok(!h.calls.some(({ args }) => ['fetch', 'checkout', 'reset', 'clean'].includes(args[0])));
});

test('issues list validates relevant GitHub prerequisites and returns references', () => {
  const h = harness();
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['issues', 'list', '--json']), h.io),
    EXIT.ok,
  );
  const result = JSON.parse(h.stdout[0]);
  assert.deepEqual(result.references.issues, [31]);
  assert.equal(result.result.issues[0].title, 'Discovery');
});

test('preflight aggregates safely evaluable failures', () => {
  const h = harness({
    'gh auth status': { stdout: '', stderr: '', status: 1 },
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '',
      stderr: '',
      status: 1,
    },
    'gh label list --repo o/r --limit 1000 --json name': { stdout: '[]', stderr: '', status: 0 },
  });
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['issues', 'list', '--json']), h.io),
    EXIT.preflight,
  );
  const checks = JSON.parse(h.stdout[0]).diagnostics.map(({ check }) => check);
  assert.deepEqual(checks, ['github-auth', 'repository-identity', 'labels']);
  assert.ok(!h.calls.some(({ args }) => args[0] === 'issue'));
});

test('external service failure uses exit 5 and never reports success', () => {
  const h = harness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '',
        stderr: 'network',
        status: 1,
      },
  });
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['issues', 'list', '--json']), h.io),
    EXIT.external,
  );
  assert.equal(JSON.parse(h.stdout[0]).status, 'failed');
});

test('all stable exit-code classes are distinct and documented', () => {
  assert.deepEqual(EXIT, { ok: 0, preflight: 2, busy: 3, blocked: 4, external: 5 });
});

test('public status result boundary emits blocked JSON and exit 4 for unreadable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-blocked-status-'));
  try {
    mkdirSync(join(root, '.sloop'));
    writeFileSync(join(root, '.sloop', 'state.json'), '{invalid');
    const h = harness({
      'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
    });
    h.io.cwd = root;
    assert.equal(
      runReadOnlyCommand(parseReadOnlyCommand(['status', '--json']), h.io),
      EXIT.blocked,
    );
    assert.equal(h.stderr.length, 0);
    assert.equal(h.stdout.length, 1);
    const result = JSON.parse(h.stdout[0]);
    assert.equal(result.status, 'blocked');
    assert.equal(result.phase, 'result');
    assert.equal(result.diagnostics[0].check, 'state');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher commands cross discovery and base-config preflight before operations', () => {
  const h = harness();
  const result = runDispatcherPreflight(['--status'], h.io);
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.root, resolve('/repo'));
  assert.equal(result.repository, 'o/r');
  assert.equal(result.config.repository.baseBranch, 'main');
  assert.deepEqual(
    h.calls.slice(0, 3).map(({ file, args }) => `${file} ${args.join(' ')}`),
    [
      'git rev-parse --show-toplevel',
      'git show HEAD:sloop.config.yaml',
      'git show origin/main:sloop.config.yaml',
    ],
  );
});

test('dispatcher preflight failure stops before any mutation-capable dependency', () => {
  const h = harness({
    'git show origin/main:sloop.config.yaml': { stdout: '', stderr: 'missing', status: 128 },
  });
  const result = runDispatcherPreflight([], h.io);
  assert.deepEqual(result, { code: EXIT.preflight });
  assert.match(h.stderr[0], /base-configuration/);
  assert.ok(!h.calls.some(({ file }) => file === 'gh'));
  assert.ok(!h.calls.some(({ args }) => ['status', 'checkout', 'reset'].includes(args[0])));
});

test('local recovery commands do not require GitHub, Codex, labels, or a clean tree', () => {
  const h = harness({
    'git status --porcelain': { stdout: 'dirty', stderr: '', status: 0 },
    'gh --version': { stdout: '', stderr: 'missing', status: 1 },
    'codex --version': { stdout: '', stderr: 'missing', status: 1 },
  });
  const result = runDispatcherPreflight(['--prepare-recovery', '31', '--pr', '54'], h.io);
  assert.equal(result.code, EXIT.ok);
  assert.ok(!h.calls.some(({ file }) => file === 'gh' || file === 'codex'));
  assert.ok(!h.calls.some(({ args }) => args[0] === 'status' || args[0] === 'symbolic-ref'));
});

test('ambiguous dispatcher command fails before discovery or mutation prerequisites', () => {
  const h = harness();
  const result = runDispatcherPreflight(['--prepare-recovery', '31', '--link-issue', '32'], h.io);
  assert.equal(result.code, EXIT.preflight);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr[0], /usage/);
});

test('missing configured remote is collected as a preflight diagnostic', () => {
  const h = harness({
    'git remote get-url origin': { stdout: '', stderr: 'missing', status: 2 },
  });
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['issues', 'list', '--json']), h.io),
    EXIT.preflight,
  );
  const checks = JSON.parse(h.stdout[0]).diagnostics.map(({ check }) => check);
  assert.ok(checks.includes('remote'));
});

test('base configuration cannot redirect the immutable bootstrap selector', () => {
  const redirected = canonicalConfigYaml().replace(
    '    # Pull-request target and healthy base branch.\n    main',
    '    # Pull-request target and healthy base branch.\n    trunk',
  );
  const h = harness({
    'git show origin/main:sloop.config.yaml': { stdout: redirected, stderr: '', status: 0 },
  });
  assert.equal(
    runReadOnlyCommand(parseReadOnlyCommand(['status', '--json']), h.io),
    EXIT.preflight,
  );
  assert.match(JSON.parse(h.stdout[0]).diagnostics[0].message, /base selector changed/);
});
