import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

function createAdapterDependenciesWithMockGitHubCommand(execute) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

const runGitCommand = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function createRepository() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-workspace-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-remote-'));
  runGitCommand(root, 'init', '-b', 'main');
  runGitCommand(root, 'config', 'user.email', 'test@example.com');
  runGitCommand(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  runGitCommand(root, 'add', '.');
  runGitCommand(root, 'commit', '-m', 'base');
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  return root;
}

test('production workspace adapter owns and cleans an isolated worktree lifecycle', () => {
  const root = createRepository();
  const config = loadConfigText(
    canonicalConfigYaml().replace('    checkout\n  path:', '    worktree\n  path:'),
  );
  const dependencies = productionDependencies(root, config, 'o/r', { execFileSync: () => '{}' });
  dependencies.save({ workerRunId: 'adapter-run' });
  const facts = dependencies.workspaceAdapter.prepare(81);

  assert.equal(dependencies.workspaceAdapter.context().executionRoot, facts.executionRoot);
  assert.equal(dependencies.runContext().executionRoot, facts.executionRoot);
  assert.equal(
    dependencies.workspaceAdapter.recover(81, 'adapter-run', facts.branch).branch,
    facts.branch,
  );
  assert.equal(dependencies.listAllWorktrees().length, 1);
  dependencies.workspaceAdapter.cleanup(facts);
  assert.equal(dependencies.workspaceAdapter.context().executionRoot, root);
  assert.equal(dependencies.listAllWorktrees().length, 0);
  dependencies.clearAllWorktrees();
}, 15_000);
