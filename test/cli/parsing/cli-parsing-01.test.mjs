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

test('help and version cannot mask unsupported or mixed command arguments', () => {
  for (const args of [
    ['--help', '--repo', 'owner/other'],
    ['--version', '--list'],
    ['--repo', 'owner/other'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /Command usage is invalid/);
    assert.equal(result.stdout, '');
  }
});

test('unknown argv fails before dispatcher loading or preflight', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['--tuvieja'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: () => 2,

        parseCliCommand: () => {
          throw new Error('unknown option --tuvieja');
        },

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: assert.fail,
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.deepEqual(output.stdout, []);
  assert.deepEqual(output.stderr, []);
});
