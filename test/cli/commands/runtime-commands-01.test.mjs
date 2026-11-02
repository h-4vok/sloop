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
