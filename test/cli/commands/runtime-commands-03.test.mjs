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
