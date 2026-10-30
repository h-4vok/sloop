import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, expect, test, vi } from 'vitest';
import { canonicalConfigYaml, loadConfigText } from '../../src/config.js';
import { executeSync } from '../../src/infrastructure/sync/executeSync.js';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(execFileSync).mockReturnValue('[]');
});

test('executeSync uses execFileSync by default for GitHub label commands', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-sync-default-runner-'));
  const config = loadConfigText(canonicalConfigYaml());
  const outputMessages = [];

  executeSync(root, config, 'example/repository', {
    output: (message) => outputMessages.push(message),
  });

  expect(execFileSync).toHaveBeenCalledWith(
    'gh',
    [
      'label',
      'list',
      '--repo',
      'example/repository',
      '--search',
      'Automation Ready',
      '--json',
      'name,color,description',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(outputMessages).toContain('Synchronized 6 labels and 6 Sloop skills.');
});
