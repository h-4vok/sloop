import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import { ArbitraryCommandRunner } from '../../../src/agent-runner.js';
import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal();
  return { ...os, tmpdir: vi.fn(os.tmpdir) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal();

  return {
    ...filesystem,

    rm: async (path, options) => {
      // Fail directory removal after the filesystem has exhausted its retry allowance.
      if (options.recursive) throw new Error('EBUSY: workspace directory is locked');

      return filesystem.rm(path, options);
    },
  };
});

const context = { run: 'run-207', issue: 207, pr: 77, round: 1, sha: 'abc123', cursor: 'cursor' };
const reviewerPayload = {
  summary: 'Accepted',

  evidence: ['Checks passed'],

  newFindings: [],

  dispositions: [],
};
const reviewerEnvelope = {
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'qa',

  status: 'accepted',

  payload: reviewerPayload,
};

function createCleanupFailureFixture() {
  const workspaceRoot = createIsolatedTemporaryDirectory(
    join(tmpdir(), 'sloop-agent-locked-test-'),
  );
  vi.mocked(tmpdir).mockReturnValueOnce(workspaceRoot);

  const reportWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => reportWarning.mockRestore());

  return { workspaceRoot, reportWarning };
}

function assertCleanupReported(reportWarning) {
  const expectedWarning = /Unable to remove temporary agent workspace .*EBUSY.*locked/;
  assert.equal(reportWarning.mock.calls.length, 1);
  assert.match(reportWarning.mock.calls[0][0], expectedWarning);
}

test('returns a persisted result and reports the failed workspace removal', async () => {
  const { workspaceRoot, reportWarning } = createCleanupFailureFixture();
  const reconciliationDir = createIsolatedTemporaryDirectory(
    join(dirname(workspaceRoot), 'sloop-agent-reconciliation-test-'),
  );
  const successfulProcess = { stdout: '', stderr: '', code: 0, signal: null };
  const execute = vi.fn(async (_command, _args, { env }) => {
    await writeFile(env.SLOOP_AGENT_OUTPUT, JSON.stringify(reviewerEnvelope));
    return successfulProcess;
  });
  const options = { cwd: workspaceRoot, reconciliationDir, execute };
  const firstRunner = new ArbitraryCommandRunner('fake', [], options);
  const freshRunner = new ArbitraryCommandRunner('fake', [], options);

  const result = await firstRunner.run('prompt', context);
  const persistedResult = await freshRunner.run('prompt', context);

  assert.deepEqual(result, reviewerEnvelope);
  assert.deepEqual(persistedResult, reviewerEnvelope);
  assert.equal(execute.mock.calls.length, 1);
  assertCleanupReported(reportWarning);
});

test('preserves the exhausted-retry error and reports the failed workspace removal', async () => {
  const { workspaceRoot, reportWarning } = createCleanupFailureFixture();
  const failedProcess = { stdout: '', stderr: 'Agent failed', code: 1, signal: null };
  const execute = vi.fn().mockResolvedValue(failedProcess);
  const options = { cwd: workspaceRoot, execute, retries: 1 };
  const runner = new ArbitraryCommandRunner('fake', [], options);
  const expectedError = {
    name: 'AgentContractError',

    code: 'operational-failure',

    message: 'Agent failed',
  };

  const execution = runner.run('prompt', context);

  await assert.rejects(execution, expectedError);
  assert.equal(execute.mock.calls.length, 2);
  assertCleanupReported(reportWarning);
});

test('preserves the preparation error and reports the failed workspace removal', async () => {
  const { workspaceRoot, reportWarning } = createCleanupFailureFixture();
  const durableRoot = createIsolatedTemporaryDirectory(
    join(dirname(workspaceRoot), 'sloop-agent-reconciliation-test-'),
  );
  const reconciliationDir = join(durableRoot, 'existing-file');
  await writeFile(reconciliationDir, 'durable data');

  const execute = vi.fn();
  const options = { cwd: workspaceRoot, reconciliationDir, execute };
  const runner = new ArbitraryCommandRunner('fake', [], options);

  const execution = runner.run('prompt', context);

  await assert.rejects(execution, { code: 'EEXIST' });
  assert.equal(execute.mock.calls.length, 0);
  assertCleanupReported(reportWarning);
});
