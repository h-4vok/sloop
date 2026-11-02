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

test('CLI parsing returns a usage error result for unsupported arguments', () => {
  const unsupportedArguments = ['--unknown'];

  const parseResult = parseCliCommandResult(unsupportedArguments);

  assert.equal(parseResult.ok, false);
  assert.match(parseResult.error, /unsupported/);
});

test.each([
  [['--resolve-review-cap', '--steer'], /--steer requires a value/],
  [
    [
      '--resolve-review-cap',
      '--steer',
      'go',
      '--additional-rounds',
      '1',
      '--additional-rounds',
      '2',
    ],
    /--additional-rounds cannot be repeated/,
  ],
  [['--resolve-review-cap', '--steer', '  ', '--abandon'], /non-empty --steer/],
])('review-cap parser returns a Result for invalid value options %j', (args, expectedMessage) => {
  const parseResult = parseCliCommandResult(args);

  assert.equal(parseResult.ok, false);
  assert.match(parseResult.error, expectedMessage);
});

test('command parser accepts only documented read-only forms', () => {
  const readOnlyArgs = ['status', '--verbose', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.deepEqual(parsedReadOnlyCommand, {
    command: 'status',

    json: true,

    verbose: true,
  });
  const readOnlyArgs2 = ['issues', 'list'];
  const parsedReadOnlyCommand2 = parseReadOnlyCommand(readOnlyArgs2);
  assert.deepEqual(parsedReadOnlyCommand2, {
    command: 'issues list',

    json: false,

    verbose: false,
  });
  const readOnlyArgs3 = ['doctor'];
  const parsedReadOnlyCommand3 = parseReadOnlyCommand(readOnlyArgs3);
  assert.deepEqual(parsedReadOnlyCommand3, {
    command: 'doctor',

    json: false,

    verbose: true,
  });
  const readOnlyArgs4 = ['--list'];
  const parsedReadOnlyCommand4 = parseReadOnlyCommand(readOnlyArgs4);
  assert.equal(parsedReadOnlyCommand4, undefined);
  const readOnlyArgs5 = ['doctor', '--json'];
  assert.throws(() => parseReadOnlyCommand(readOnlyArgs5), /usage:/);
  const readOnlyArgs6 = ['status', '--verbose'];
  assert.throws(() => parseReadOnlyCommand(readOnlyArgs6), /requires --json/);
});

test('top-level parser rejects unknown argv before a dispatcher command can exist', () => {
  const cliArgs = [];
  const parsedCliCommand = parseCliCommand(cliArgs);
  assert.deepEqual(parsedCliCommand, { kind: 'dispatcher', command: { kind: 'workflow' } });
  const cliArgs2 = ['status', '--help'];
  const parsedCliCommand2 = parseCliCommand(cliArgs2);
  assert.deepEqual(parsedCliCommand2, { kind: 'help', target: 'status' });
  const cliArgs3 = ['--prepare-recovery', '--help'];
  const parsedCliCommand3 = parseCliCommand(cliArgs3);
  assert.deepEqual(parsedCliCommand3, {
    kind: 'help',

    target: '--prepare-recovery',
  });
  for (const [args, guidance] of [
    [['--list', '--help'], 'sloop issues list'],
    [['--status', '--help'], 'sloop status'],
  ])
    assert.throws(
      () => parseCliCommand(args),
      new RegExp(`no longer supported.*${guidance.replaceAll(' ', '\\s+')}`),
    );
  for (const args of [
    ['--tuvieja'],
    ['status', '--tuvieja'],
    ['issues', 'list', 'extra'],
    ['--link-issue'],
    ['--help', '--tuvieja'],
    ['status', '--verbose', '--help'],
    ['--version', '--list'],
  ])
    assert.throws(
      () => parseCliCommand(args),
      /unsupported|supported|requires|must be|usage|mixed|accepts/,
    );
});

test.each([
  [['--resolve-review-cap', '--unknown'], /unsupported command arguments/],
  [['--resolve-review-cap', '--waive-all-outstanding'], /exactly one --steer/],
  [
    ['--resolve-review-cap', '--steer', 'go', '--additional-rounds', 'many'],
    /non-negative integer/,
  ],
  [['--resolve-review-cap', '--steer', 'go', '--waive', 'Q1,invalid'], /comma-separated/],
  [['--resolve-review-cap', '--steer', 'go', '--abandon', '--waive', 'Q1'], /cannot be combined/],
  [['--resolve-review-cap', '--steer', 'go'], /choose --additional-rounds/],
])('review-cap parser rejects invalid argument form %j', (args, expectedError) => {
  assert.throws(() => parseCliCommand(args), expectedError);
});
