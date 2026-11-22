import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, vi } from 'vitest';
import { ArbitraryCommandRunner } from '../../../src/agent-runner.js';
import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal();
  return { ...os, tmpdir: vi.fn(os.tmpdir) };
});

const context = { run: 'run-207', issue: 207, pr: 77, round: 1, sha: 'abc123', cursor: 'cursor' };
const workerGuide = {
  summary: 'Verify the issue',

  steps: ['Run Sloop'],

  expected: ['Issue reaches review'],

  isolation: 'Use a fixture repository',

  limitations: ['Uses a fake agent'],

  checklist: ['Review the result'],
};
const workerEnvelope = {
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'worker',

  status: 'ready',

  payload: {
    summary: 'Ready for review',
    findingResolutions: [],
    verification: ['Checks passed'],
    guide: workerGuide,
  },
};

const successfulProcess = { stdout: '', stderr: '', code: 0, signal: null };
const failedProcess = { stdout: '', stderr: 'Agent exited unsuccessfully', code: 1, signal: null };

function isolateWorkspaceRoot() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-workspace-test-'));
  vi.mocked(tmpdir).mockReturnValueOnce(root);
  return root;
}

test('cleans up a successful workspace and preserves the durable result for a new runner', async () => {
  const workspaceRoot = isolateWorkspaceRoot();
  const reconciliationRoot = createIsolatedTemporaryDirectory(
    join(dirname(workspaceRoot), 'sloop-agent-reconciliation-test-'),
  );
  const execute = vi.fn(async (_command, _args, { env }) => {
    await writeFile(env.SLOOP_AGENT_OUTPUT, JSON.stringify(workerEnvelope));
    return successfulProcess;
  });
  const options = { cwd: workspaceRoot, reconciliationDir: reconciliationRoot, execute };
  const firstRunner = new ArbitraryCommandRunner('fake', [], options);
  const freshRunner = new ArbitraryCommandRunner('fake', [], options);

  const firstResult = await firstRunner.run('prompt', context);
  const workspaceEntries = await readdir(workspaceRoot);
  const reconciledResult = await freshRunner.run('prompt', context);

  assert.deepEqual(workspaceEntries, []);
  assert.deepEqual(firstResult, workerEnvelope);
  assert.deepEqual(reconciledResult, firstResult);
  assert.equal(execute.mock.calls.length, 1);
});

test('retains the prepared workspace until a retry succeeds', async () => {
  const workspaceRoot = isolateWorkspaceRoot();
  const execute = vi
    .fn()
    .mockImplementationOnce(async (_command, _args, { env }) => {
      await writeFile(env.SLOOP_AGENT_OUTPUT, 'stale output');
      return failedProcess;
    })
    .mockImplementationOnce(async (_command, _args, { env }) => {
      assert.equal(await readFile(env.SLOOP_AGENT_INPUT, 'utf8'), 'prompt');
      assert.ok(await readFile(env.SLOOP_AGENT_SCHEMA, 'utf8'));
      await assert.rejects(readFile(env.SLOOP_AGENT_OUTPUT), { code: 'ENOENT' });
      await writeFile(env.SLOOP_AGENT_OUTPUT, JSON.stringify(workerEnvelope));
      return successfulProcess;
    });
  const options = { cwd: workspaceRoot, retries: 1, execute };
  const runner = new ArbitraryCommandRunner('fake', [], options);

  const result = await runner.run('prompt', context);
  const workspaceEntries = await readdir(workspaceRoot);

  assert.equal(result.status, 'ready');
  assert.equal(execute.mock.calls.length, 2);
  assert.deepEqual(workspaceEntries, []);
});

test('cleans up the workspace when all attempts fail', async () => {
  const workspaceRoot = isolateWorkspaceRoot();
  const execute = vi.fn(async (_command, _args, { env }) => {
    await writeFile(env.SLOOP_AGENT_OUTPUT, 'partial output');
    return failedProcess;
  });
  const options = { cwd: workspaceRoot, retries: 1, execute };
  const runner = new ArbitraryCommandRunner('fake', [], options);

  const execution = runner.run('prompt', context);

  await assert.rejects(execution, { code: 'operational-failure' });
  assert.equal(execute.mock.calls.length, 2);
  assert.deepEqual(await readdir(workspaceRoot), []);
});

test('cleans up a partially prepared workspace when the reconciliation directory cannot be created', async () => {
  const workspaceRoot = isolateWorkspaceRoot();
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
  assert.deepEqual(await readdir(workspaceRoot), []);
  assert.equal(await readFile(reconciliationDir, 'utf8'), 'durable data');
});
