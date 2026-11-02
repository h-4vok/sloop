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

test('worktree preparation persists facts, supports recovery, listing, and cleanup', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, listWorkspaces, cleanupWorkspace } =
    await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const customRoot = join(root, 'isolated');
  const opts = createWorkspaceOptions(root, { worktreeRoot: customRoot });
  const facts = prepareWorktreeWorkspace(opts);

  assert.equal(resolve(facts.executionRoot).startsWith(resolve(customRoot)), true);
  assert.notEqual(facts.executionRoot, facts.workspaceRoot);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'base\n');
  assert.equal(recoverWorkspace(opts).executionRoot, facts.executionRoot);
  assert.deepEqual(listWorkspaces(root), [
    { path: facts.executionRoot, branch: facts.branch, issue: 32, pr: '—' },
  ]);
  cleanupWorkspace(facts, root);
  assert.equal(listWorkspaces(root).length, 0);
}, 30_000);

test('recovery and cleanup use the persisted base when the remote advances', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace, listWorkspaces } =
    await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const opts = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(opts);

  runGitCommand(root, 'checkout', 'main');
  writeFileSync(join(root, 'advanced.txt'), 'advanced\n');
  runGitCommand(root, 'add', 'advanced.txt');
  runGitCommand(root, 'commit', '-m', 'advance remote base');
  runGitCommand(root, 'push', 'origin', 'main');

  assert.equal(recoverWorkspace(opts).baseSha, facts.baseSha);
  cleanupWorkspace(facts, root);
  assert.equal(listWorkspaces(root).length, 0);
}, 15_000);

test('branch collisions regenerate a unique name and clear removes only owned worktrees', async () => {
  const { prepareWorktreeWorkspace, clearWorkspaces, listWorkspaces } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const first = prepareWorktreeWorkspace(createWorkspaceOptions(root));
  const second = prepareWorktreeWorkspace(createWorkspaceOptions(root, { runId: 'run-87654321' }));

  assert.notEqual(second.branch, first.branch);
  assert.equal(listWorkspaces(root).length, 2);
  clearWorkspaces(root);
  assert.equal(listWorkspaces(root).length, 0);
}, 30_000);

test('recovery and cleanup fail closed for fake or dirty registered targets', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace, listWorkspaces } =
    await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const opts = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(opts);
  const stateFile = join(root, '.sloop', 'state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.workspaces[0].executionRoot = join(root, 'isolated', 'fake');
  mkdirSync(state.workspaces[0].executionRoot, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state));

  assert.equal(recoverWorkspace(opts), undefined);
  state.workspaces[0].executionRoot = facts.executionRoot;
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(join(facts.executionRoot, 'user.txt'), 'keep');
  assert.throws(() => cleanupWorkspace(facts, root), /dirty/);
  assert.equal(listWorkspaces(root).length, 1);
}, 30_000);
