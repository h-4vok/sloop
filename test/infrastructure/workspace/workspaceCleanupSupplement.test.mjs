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

test('cleanup preserves a remote-owned workspace that contains unrecognized files', async () => {
  const { prepareWorktreeWorkspace, cleanupWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(options);
  writeFileSync(join(facts.executionRoot, 'user.txt'), 'preserve this workspace');
  writeFileSync(join(root, '.sloop', 'state.json'), '{"workspaces":[]}\n');

  assert.throws(
    () => cleanupWorkspace(facts, root),
    /remote-owned workspace could not be verified/,
  );
  assert.equal(existsSync(join(facts.executionRoot, 'user.txt')), true);
}, 30_000);

test('cleanup rejects registered facts when their ancestry cannot be verified', async () => {
  const { prepareWorktreeWorkspace, cleanupWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(options);
  facts.baseSha = 'not-a-commit';
  const stateFile = join(root, '.sloop', 'state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.workspaces[0].baseSha = facts.baseSha;
  writeFileSync(stateFile, JSON.stringify(state));

  assert.throws(
    () => cleanupWorkspace(facts, root),
    /workspace registration or facts could not be verified/,
  );
  assert.equal(existsSync(facts.executionRoot), true);
}, 30_000);
