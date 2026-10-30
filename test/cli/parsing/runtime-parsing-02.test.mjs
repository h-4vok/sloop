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

test('dispatcher parser defaults to the workflow command', () => {
  const dispatcherArgs = [];
  const expectedCommand = { kind: 'workflow' };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser accepts a complete recovery command', () => {
  const dispatcherArgs = ['--prepare-recovery', '31', '--pr', '54'];
  const expectedCommand = {
    kind: 'prepare-recovery',

    issue: 31,

    pr: 54,
  };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser accepts review cap options', () => {
  const dispatcherArgs = [
    '--resolve-review-cap',
    '--steer',
    'continue',
    '--additional-rounds',
    '1',
    '--waive',
    'S1,Q2',
  ];
  const expectedCommand = {
    kind: 'resolve-review-cap',

    options: {
      steer: 'continue',

      additionalRounds: 1,

      waivedFindingIds: ['S1', 'Q2'],

      waiveAllOutstanding: false,

      abandon: false,
    },
  };
  const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
  const parsedCommand = parsedDispatcherCommand;

  assert.deepEqual(parsedCommand, expectedCommand);
});

test('dispatcher parser rejects mixed, unsupported, and duplicate commands', () => {
  const dispatcherArgs = ['--prepare-recovery', '31', '--link-issue', '32'];
  assert.throws(
    () => parseDispatcherCommand(dispatcherArgs),
    /mixed, duplicate, unknown, or unsupported/,
  );
  const dispatcherArgs2 = ['--repo', 'owner/other'];
  assert.throws(() => parseDispatcherCommand(dispatcherArgs2), /unsupported/);
  const dispatcherArgs3 = ['--list', '--list'];
  assert.throws(() => parseDispatcherCommand(dispatcherArgs3), /duplicate/);
});

test('dispatcher parser accepts every supported control command family', () => {
  for (const args of [
    ['--list'],
    ['--recover-lock'],
    ['--reset'],
    ['--list-all-worktrees'],
    ['--clear-all-worktrees'],
    ['--link-issue', '1'],
    ['--resolve-review-cap', '--steer', 'go', '--waive-all-outstanding'],
    ['--resolve-review-cap', '--steer', 'go', '--abandon'],
  ])
    assert.doesNotThrow(() => parseDispatcherCommand(args));
});

test('CLI parser accepts supported read-only and configuration commands', () => {
  for (const args of [
    ['status', '--verbose', '--json'],
    ['issues', 'list', '--json'],
    ['doctor'],
    ['config', 'install', '--force'],
    ['config', 'x'],
  ])
    assert.doesNotThrow(() => parseCliCommand(args));
});
