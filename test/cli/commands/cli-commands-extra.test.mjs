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

test('runCli handles injected help and version commands without preflight', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;
  const parseResults = [{ kind: 'help', target: 'status' }, { kind: 'version' }];

  try {
    for (const command of parseResults) {
      await runCli(['status'], process.version, {
        runtime: {
          emitNodeVersionFailure: assert.fail,

          emitUsageFailure: assert.fail,

          parseCliCommand: () => command,

          runDispatcherPreflight: assert.fail,

          runReadOnlyCommand: assert.fail,
        },

        dispatcher: { runDispatcherCli: assert.fail },

        adapters: { productionDependencies: assert.fail },
      });
      assert.equal(process.exitCode, 0);
    }
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stdout[0], 'Usage: sloop status [--verbose] [--json]');
  assert.match(output.stdout[1], versionPattern);
  assert.deepEqual(output.stderr, []);
});
