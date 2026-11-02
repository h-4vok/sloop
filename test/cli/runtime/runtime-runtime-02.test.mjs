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
