import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

const loadWorkspaceModule = async () => {
  const { workspaceAdapter } = await import('../../../src/workspace.ts');

  return workspaceAdapter;
};

const runGitCommand = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const createRepository = () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-workspace-'));
  runGitCommand(root, 'init', '-b', 'main');
  runGitCommand(root, 'config', 'user.email', 'test@example.com');
  runGitCommand(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  runGitCommand(root, 'add', '.');
  runGitCommand(root, 'commit', '-m', 'base');
  return root;
};

const createWorkspaceOptions = (root, extra = {}) => ({
  repositoryRoot: root,

  remote: 'origin',

  baseBranch: 'main',

  branchPrefix: 'sloop/',

  issue: 32,

  runId: 'run-12345678',

  ...extra,
});

test('workspace root exports preserve the named compatibility API', async () => {
  const workspaceModule = await import('../../../src/workspace.ts');

  assert.equal(
    workspaceModule.prepareWorktreeWorkspace,
    workspaceModule.workspaceAdapter.prepareWorktreeWorkspace,
  );
  assert.equal(workspaceModule.cleanupWorkspace, workspaceModule.workspaceAdapter.cleanupWorkspace);
});

test('checkout preparation uses the configured base SHA and rejects dirty trees', async () => {
  const { prepareCheckoutWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const facts = prepareCheckoutWorkspace(createWorkspaceOptions(root));

  assert.equal(facts.baseSha, runGitCommand(root, 'rev-parse', 'origin/main'));
  assert.equal(facts.headSha, facts.baseSha);
  assert.match(facts.branch, /^sloop\/32-[0-9a-f]{4}$/);
  writeFileSync(join(root, 'dirty.txt'), 'do not discard');
  assert.throws(
    () => prepareCheckoutWorkspace(createWorkspaceOptions(root, { issue: 33 })),
    /dirty\.txt/,
  );
}, 30_000);

test('worktree preparation refuses to overwrite an existing execution directory', async () => {
  const { prepareWorktreeWorkspace, cleanupWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const createdWorkspace = prepareWorktreeWorkspace(options);

  assert.throws(() => prepareWorktreeWorkspace(options), /worktree target already exists/);

  cleanupWorkspace(createdWorkspace, root);
}, 30_000);
