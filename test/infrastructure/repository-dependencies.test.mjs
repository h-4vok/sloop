import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, vi } from 'vitest';
import { canonicalConfigYaml, loadConfigText } from '../../src/config.js';
import { createRepositoryDependencies } from '../../src/infrastructure/adapters/createRepositoryDependencies.js';
import { RunLogger } from '../../src/run-log.js';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';

function createTestDependencies() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-repository-dependencies-'));
  const config = loadConfigText(canonicalConfigYaml());

  return createRepositoryDependencies(root, config, 'owner/repository', {
    execFileSync: () => '{}',
  });
}

test('repository dependencies create run loggers under the configured root', () => {
  const adapterDependencies = createTestDependencies();

  const logger = adapterDependencies.createRunLogger(81, 'recovery-run');

  assert.ok(logger instanceof RunLogger);
  assert.match(logger.file, /\.sloop[\\/]runs[\\/].*-issue-81-recovery-run[\\/]events\.jsonl$/);
});

test('repository dependencies report status messages to stderr', () => {
  const adapterDependencies = createTestDependencies();
  const statusMessage = 'dispatcher is ready';
  const stderrWrite = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    adapterDependencies.reportStatus(statusMessage);

    assert.deepEqual(stderrWrite.mock.calls, [[statusMessage]]);
  } finally {
    stderrWrite.mockRestore();
  }
});
