import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
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
} from '../../../src/runtime.js';
import { canonicalConfigYaml } from '../../../src/config.js';

import {
  config,
  unwrap,
  parseCliCommand,
  parseReadOnlyCommand,
  parseDispatcherCommand,
  discoverRepository,
  createMockRuntimeHarness,
} from '../support/runtime-support.mjs';

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
