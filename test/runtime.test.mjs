import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  discoverRepository,
  EXIT,
  parseReadOnlyCommand,
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
    'gh --version': { stdout: 'gh version 2', stderr: '', status: 0 },
    'gh auth status': { stdout: '', stderr: '', status: 0 },
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '{"nameWithOwner":"o/r","viewerPermission":"WRITE"}',
      stderr: '',
      status: 0,
    },
    'gh label list --limit 1000 --json name': {
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
    'gh issue list --state open --label Automation Ready --json number,title,url,labels': {
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

test('repository discovery uses the invocation cwd and normalizes one Git root', () => {
  const h = harness();
  assert.equal(discoverRepository(h.io), resolve('/repo'));
  assert.equal(h.calls[0].cwd, '/repo/nested');
  assert.deepEqual(h.calls[0].args, ['rev-parse', '--show-toplevel']);
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
    'gh label list --limit 1000 --json name': { stdout: '[]', stderr: '', status: 0 },
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
    'gh issue list --state open --label Automation Ready --json number,title,url,labels': {
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
