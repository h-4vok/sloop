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
