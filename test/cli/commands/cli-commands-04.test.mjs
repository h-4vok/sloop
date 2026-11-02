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

test('CLI executes the production config imports in the current repository', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show']);
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stderr.length, 0);
  assert.equal(output.stdout.length, 1);
});

test('help and version work outside the Sloop checkout', () => {
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-cli-outside-'));

  try {
    for (const flag of ['--help', '--version']) {
      const result = spawnSync(process.execPath, [cli, flag], { cwd: outside, encoding: 'utf8' });
      assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
      assert.notEqual(result.stdout.trim(), '');
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('legacy dispatcher executable delegates through repository discovery', () => {
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-outside-'));

  try {
    const result = spawnSync(process.execPath, [resolve('dist/dispatcher.js'), '--status'], {
      cwd: outside,

      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no longer supported; use `sloop status`/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('unsupported Node stops before dispatcher loading', () => {
  assert.throws(() => requireSupportedNode('v21.9.0'), /requires Node\.js 22 or newer.*v21\.9\.0/);
  const result = spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',

    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires Node\.js 22 or newer/);
  assert.equal(result.stdout, '');
});

test('public dispatcher failure emitter preserves busy exit and stream contract', () => {
  const stdout = [];
  const stderr = [];
  const logger = {
    log: (message) => stdout.push(message),

    error: (message) => stderr.push(message),
  };

  assert.equal(emitDispatcherFailure(new CliFailure(3, 'Issue is already owned.'), logger), 3);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['[sloop] Issue is already owned.']);
});

test('public dispatcher failure emitter maps external service errors to exit 5', () => {
  const stdout = [];
  const stderr = [];
  const logger = {
    log: (message) => stdout.push(message),

    error: (message) => stderr.push(message),
  };
  const externalServiceError = new ExternalServiceError('github', 'GitHub request failed.');

  const exitCode = emitDispatcherFailure(externalServiceError, logger);

  assert.equal(exitCode, 5);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['[sloop] GitHub request failed.']);
});
