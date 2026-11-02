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

test('runCli preserves the public blocked exit and JSON stream contract', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['status', '--json'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,

        emitUsageFailure: assert.fail,

        parseCliCommand: () => ({
          kind: 'read-only',

          command: { command: 'status', json: true, verbose: false },
        }),

        runDispatcherPreflight: assert.fail,

        runReadOnlyCommand: (_command, io) => {
          io.stdout(
            JSON.stringify({
              command: 'status',

              status: 'blocked',

              phase: 'workflow',

              summary: 'Workflow is blocked.',

              result: null,

              diagnostics: [],

              references: { issues: [31], pullRequests: [54] },
            }),
          );
          return 4;
        },
      },

      dispatcher: { runDispatcherCli: assert.fail },

      adapters: { productionDependencies: assert.fail },
    });
    assert.equal(process.exitCode, 4);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stderr.length, 0);
  assert.equal(output.stdout.length, 1);
  const envelope = JSON.parse(output.stdout[0]);
  assert.equal(envelope.status, 'blocked');
  assert.equal(envelope.phase, 'workflow');
  assert.deepEqual(envelope.references, { issues: [31], pullRequests: [54] });
});

test('the executable CLI wrapper forwards arguments and reports rejected startup', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTestNodeVersion = process.env.SLOOP_TEST_NODE_VERSION;
  const startCli = { start: vi.fn(async () => {}) };
  const loggerError = vi.fn();

  vi.doMock('../../../src/application/cli/index.js', () => ({ startCli }));
  vi.doMock('../../../src/infrastructure/index.js', () => ({
    consoleLogger: { error: loggerError },
  }));

  try {
    process.argv = [process.execPath, '/test/not-the-entrypoint.js'];
    vi.resetModules();
    const cliModule = await import('../../../src/cli.js');
    await cliModule.cli.runCli(['--version'], 'v22.1.0');

    assert.deepEqual(startCli.start.mock.calls[0], [['--version'], packageVersion, 'v22.1.0']);

    startCli.start.mockRejectedValueOnce(new Error('startup failed'));
    process.argv = [process.execPath, '/test/cli.js', 'status', '--json'];
    vi.resetModules();
    await import('../../../src/cli.js');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(process.exitCode, 2);
    assert.deepEqual(loggerError.mock.calls, [['[sloop] startup failed']]);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalTestNodeVersion === undefined) delete process.env.SLOOP_TEST_NODE_VERSION;
    else process.env.SLOOP_TEST_NODE_VERSION = originalTestNodeVersion;
    vi.doUnmock('../../../src/application/cli/index.js');
    vi.doUnmock('../../../src/infrastructure/index.js');
    vi.resetModules();
  }
});
