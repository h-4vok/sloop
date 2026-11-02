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

test('help documents the linked CLI contract', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Sloop \d+\.\d+\.\d+/m);
  assert.match(result.stdout, /Usage: sloop <command> \[option\]/);
  assert.match(result.stdout, /--prepare-recovery N \[--pr PR\]/);
  assert.match(result.stdout, /--resolve-review-cap --steer TEXT/);
  assert.match(result.stdout, /--additional-rounds N/);
  assert.match(result.stdout, /--waive Q1,Q2/);
  assert.match(result.stdout, /--waive-all-outstanding/);
  assert.match(result.stdout, /--abandon/);
  assert.equal(result.stdout.trim(), HELP);
});

test('version reports the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), versionPattern);
});

test('runCli emits the public node-version failure through injected runtime seams', async () => {
  let received;
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--help'], 'v20.0.0', {
      runtime: {
        emitNodeVersionFailure: (args, version) => {
          received = [args, version];
          return 7;
        },

        emitUsageFailure: assert.fail,

        parseCliCommand: assert.fail,

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.deepEqual(received, [['--help'], 'v20.0.0']);
  assert.equal(exitCode, 7);
});

test('runCli falls back to general help for an unknown help target', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;
  try {
    await runCli(['help'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({ kind: 'help', target: 'unknown-target' }),

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
  } finally {
    process.exitCode = undefined;
    output.restore();
  }

  assert.deepEqual(output.stdout, [HELP]);
});

test('config show uses the production repository discovery and read-only configuration path', () => {
  const result = spawnSync(process.execPath, [cli, 'config', 'show'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^schemaVersion:/m);
});
