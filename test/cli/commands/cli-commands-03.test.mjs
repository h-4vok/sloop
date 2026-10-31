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

test('runCli stops dispatcher execution when preflight fails', async () => {
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({
          ok: true,

          value: { kind: 'dispatcher', command: { kind: 'list' } },
        }),

        runDispatcherPreflight: () => ({ code: 6, diagnostics: [] }),

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.equal(exitCode, 6);
});

test('runner loads production dispatcher modules for dispatcher commands', async () => {
  const cliRunner = createCli({
    host: { ...createNodeHost(), nodeVersion: process.version },

    logger: { log: assert.fail, error: assert.fail },

    version: packageVersion,

    modules: {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({
          ok: true,

          value: { kind: 'dispatcher', command: { kind: 'list' } },
        }),

        runDispatcherPreflight: () => ({ code: 6, diagnostics: [] }),

        runReadOnlyCommand: assert.fail,
      },
    },
  });

  assert.equal(await cliRunner.runCliCommand(['--list']), 6);
});

test('runCli dispatches commands after successful preflight', async () => {
  const calls = [];
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--list'], process.version, createSuccessfulPreflightModules(calls));
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ['dependencies', '/repo', { mode: 'test' }, 'owner/repo'],
    ['dispatcher', { kind: 'list' }, { isolated: true }],
  ]);
});

function createSuccessfulPreflightModules(calls) {
  return {
    runtime: {
      emitNodeVersionFailure: assert.fail,
      emitUsageFailure: assert.fail,
      parseCliCommand: () => ({ kind: 'dispatcher', command: { kind: 'list' } }),
      runDispatcherPreflight: () => ({
        code: 0,
        diagnostics: [],
        root: '/repo',
        config: { mode: 'test' },
        repository: 'owner/repo',
      }),
      runReadOnlyCommand: assert.fail,
    },
    dispatcher: {
      runDispatcherCli: async (command, dependencies) => {
        calls.push(['dispatcher', command, dependencies]);
        return 0;
      },
    },
    adapters: {
      productionDependencies: (root, config, repository) => {
        calls.push(['dependencies', root, config, repository]);
        return { isolated: true };
      },
    },
  };
}
