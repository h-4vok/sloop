import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalConfigYaml, loadConfigText } from '../../src/config.js';
import { createIsolatedTemporaryDirectory } from './temporary-directory.mjs';

export function createSyncFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-sync-'));
  writeFileSync(join(root, 'sloop.config.yaml'), canonicalConfigYaml());
  const calls = [];
  const runner = (file, args) => {
    calls.push([file, [...args]]);
    if (file === 'git') return 'https://github.com/example/repo.git';
    if (args[0] === 'label' && args[1] === 'list') return '[]';
    return '';
  };

  return { root, calls, runner, config: loadConfigText(canonicalConfigYaml()) };
}
