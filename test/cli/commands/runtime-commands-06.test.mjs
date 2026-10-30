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
