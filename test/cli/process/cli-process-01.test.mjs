import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import { ExternalServiceError } from '../../../src/core/ExternalServiceError.js';
import { CliFailure } from '../../../src/dispatcher.js';
import {
  createCli,
  createHelp,
  emitDispatcherFailure,
  requireSupportedNode,
  startCli,
} from '../../../src/application/cli/index.js';
import { createNodeHost } from '../../../src/infrastructure/host/index.js';
import { EXIT, resultOutput } from '../../../src/runtime.js';

import {
  cli,
  versionPattern,
  packageVersion,
  HELP,
  activeOutput,
  runCli,
  captureCliOutput,
} from '../support/cli-support.mjs';

test('CLI bootstrap connects the production runner to its injected host and logger', async () => {
  const stdout = [];
  const stderr = [];
  process.exitCode = undefined;

  await startCli.start(['--version'], packageVersion, process.version, {
    host: createNodeHost(),

    logger: {
      log: (message) => stdout.push(message),

      error: (message) => stderr.push(message),
    },
  });

  assert.equal(process.exitCode, 0);
  assert.deepEqual(stdout, [packageVersion]);
  assert.deepEqual(stderr, []);
  process.exitCode = undefined;
});

test('runCli reports non-Error usage failures', async () => {
  const output = captureCliOutput();
  const usageFailures = [];
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['unknown'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: (args, message) => {
          usageFailures.push([args, message]);
          return 9;
        },

        parseCliCommand: () => {
          throw 'plain failure';
        },

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
    output.restore();
  }

  assert.equal(exitCode, 9);
  assert.deepEqual(usageFailures, [[['unknown'], 'plain failure']]);
});

test('unsupported Node emits the global envelope when JSON was requested', () => {
  const result = spawnSync(process.execPath, [cli, 'status', '--json'], {
    encoding: 'utf8',

    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, 'status');
  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.phase, 'preflight');
  assert.equal(envelope.diagnostics[0].check, 'node');
});

test('runCli preserves the public busy exit and human stream contract', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({ kind: 'dispatcher', command: { kind: 'list' } }),

        runDispatcherPreflight: () => ({
          code: 0,

          diagnostics: [],

          root: '/repo',

          config: {},

          repository: 'owner/repo',
        }),

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: {
        runDispatcherCli: async () => {
          throw new CliFailure(3, 'Issue is already owned.');
        },
      },

      adapters: { productionDependencies: () => ({}) },
    });
    assert.equal(process.exitCode, 3);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.deepEqual(output.stdout, []);
  assert.deepEqual(output.stderr, ['[sloop] Issue is already owned.']);
});
