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

test('clear retains registrations whose Git ancestry cannot be verified', async () => {
  const workspaceModule = await loadWorkspaceModule();
  const repositoryRoot = createRepository();
  const remoteRepository = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));

  // Arrange a registered worktree with a valid local remote before invalidating its base commit.
  runGitCommand(remoteRepository, 'init', '--bare');
  runGitCommand(repositoryRoot, 'remote', 'add', 'origin', remoteRepository);
  runGitCommand(repositoryRoot, 'push', '-u', 'origin', 'main');

  const worktreeRoot = join(repositoryRoot, 'isolated');
  const workspaceOptions = createWorkspaceOptions(repositoryRoot, { worktreeRoot });
  const workspaceFacts = workspaceModule.prepareWorktreeWorkspace(workspaceOptions);
  const stateFile = join(repositoryRoot, '.sloop', 'state.json');
  const stateJson = readFileSync(stateFile, 'utf8');
  const persistedState = JSON.parse(stateJson);
  const registeredWorkspace = persistedState.workspaces[0];
  registeredWorkspace.baseSha = 'not-a-commit';

  writeFileSync(stateFile, JSON.stringify(persistedState));

  // Act: cleanup cannot prove ancestry, so it must preserve the registered worktree.
  workspaceModule.clearWorkspaces(repositoryRoot);

  // Assert: both the registration and its execution directory remain available.
  const remainingWorkspaces = workspaceModule.listWorkspaces(repositoryRoot);
  const isExecutionRootPresent = existsSync(workspaceFacts.executionRoot);

  assert.equal(remainingWorkspaces.length, 1);
  assert.equal(isExecutionRootPresent, true);
}, 30_000);

test('worktree parser ignores incomplete records and clear preserves unsafe registrations', async () => {
  const { clearWorkspaces, listWorkspaces } = await loadWorkspaceModule();
  const root = createRepository();
  const stateFile = join(root, '.sloop', 'state.json');
  const outside = join(tmpdir(), 'sloop-outside-target');
  mkdirSync(join(root, '.sloop'), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify({
      workspaces: [
        {
          repositoryRoot: root,

          executionRoot: outside,

          branch: 'other',

          headSha: 'x',

          baseSha: 'x',

          worktreeRoot: root,

          ownership: { runId: 'x', issue: 1, protocol: 'wrong' },
        },
        {
          repositoryRoot: root,

          executionRoot: join(root, 'missing'),

          branch: 'other',

          headSha: 'x',

          baseSha: 'x',

          worktreeRoot: root,

          ownership: { runId: 'x', issue: 2, protocol: 'sloop-workspace-v1' },
        },
      ],
    }),
  );
  clearWorkspaces(root, stateFile);

  assert.equal(listWorkspaces(root, stateFile).length, 2);
});
