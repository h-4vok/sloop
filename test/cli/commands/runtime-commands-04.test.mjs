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
