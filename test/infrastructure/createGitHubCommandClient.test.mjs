import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test, vi } from 'vitest';
import { gitHubCommandClientFactory } from '../../src/infrastructure/adapters/createGitHubCommandClient.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

test('uses the default execFileSync adapter for repository-scoped commands', () => {
  const root = 'C:/repositories/project';
  const repository = 'owner/repository';
  const commandOutput = Buffer.from('status output');
  const expectedOptions = { cwd: root };
  vi.mocked(execFileSync).mockReturnValue(commandOutput);

  const client = gitHubCommandClientFactory.create(root, repository);

  const output = client.run(['pr', 'list']);

  assert.equal(output, 'status output');
  assert.deepEqual(execFileSync.mock.calls, [
    ['gh', ['pr', 'list', '--repo', repository], expectedOptions],
  ]);
});
