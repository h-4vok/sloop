import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { createNodeHost } from '../../../src/infrastructure/host/createNodeHost.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { withEphemeralMutex, withEphemeralMutexAsync } from '../../../src/mutex.js';

import { RunLogger, applyRunRetention, runDirectory } from '../../../src/run-log.js';

import {
  RunLogger as infrastructureRunLogger,
  applyRunRetention as infrastructureApplyRunRetention,
  runDirectory as infrastructureRunDirectory,
} from '../../../src/infrastructure/logging/index.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

test('run-log root preserves its public infrastructure imports', () => {
  assert.equal(RunLogger, infrastructureRunLogger);
  assert.equal(applyRunRetention, infrastructureApplyRunRetention);
  assert.equal(runDirectory, infrastructureRunDirectory);
});

test('Node host exposes readable-file checks and command outcomes', () => {
  const directory = createTemporaryDirectory('sloop-node-host-');
  const readableFile = join(directory, 'readable.txt');
  writeFileSync(readableFile, 'host fixture');
  const nodeHost = createNodeHost();

  assert.equal(nodeHost.canRead(readableFile), true);
  assert.equal(nodeHost.canRead(join(directory, 'missing.txt')), false);
  assert.equal(nodeHost.readFile(readableFile), 'host fixture');
  assert.deepEqual(nodeHost.run(process.execPath, ['-e', 'process.stdout.write("host-ok")']), {
    stdout: 'host-ok',

    stderr: '',

    status: 0,
  });
});
