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

test('all stable exit-code classes are distinct and documented', () => {
  assert.deepEqual(EXIT, { ok: 0, preflight: 2, busy: 3, blocked: 4, external: 5 });
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
