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

test('runCli routes config commands through injected config adapters after discovery', async () => {
  const calls = [];
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({ kind: 'config', args: ['show'] }),

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,

        discoverRepository: (io) => {
          assert.equal(typeof io.run, 'function');
          assert.equal(typeof io.readFile, 'function');
          assert.equal(io.run(process.execPath, ['--version']).status, 0);
          assert.match(io.readFile(resolve('package.json')), /"name": "sloop"/);
          return 'C:/isolated';
        },
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },

      config: {
        productionConfigReconciler: (root) => {
          calls.push(['reconciler', root]);
          return async () => {};
        },

        runConfigCommand: {
          run: async (root, args, reconciler) => {
            calls.push(['run', root, args, typeof reconciler]);
            return 0;
          },
        },
      },
    });
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = undefined;
  }
  assert.deepEqual(calls, [
    ['reconciler', 'C:/isolated'],
    ['run', 'C:/isolated', ['show'], 'function'],
  ]);
});

test('config command emits a discovery diagnostic when repository discovery fails', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({ ok: true, value: { kind: 'config', args: ['show'] } }),

        discoverRepository: () => ({
          ok: false,

          error: {
            check: 'repository',

            message: 'The current directory is not inside a Git repository.',

            remediation: 'Change to the target repository.',
          },
        }),

        resultOutput,

        EXIT,

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,
      },
    });

    assert.equal(process.exitCode, EXIT.preflight);
    assert.match(output.stderr[0], /Repository startup failed/);
    assert.match(output.stderr[0], /\[repository\]/);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
});
