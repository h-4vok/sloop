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

test('worker recovery retains dispatch ownership, refreshes a pushed head, and cleans Serena metadata', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace, listWorkspaces } =
    await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const opts = createWorkspaceOptions(root, {
    runId: 'dispatch-12345678',

    worktreeRoot: join(root, 'isolated'),
  });
  const facts = prepareWorktreeWorkspace(opts);

  writeFileSync(join(facts.executionRoot, 'worker.txt'), 'completed work\n');
  runGitCommand(facts.executionRoot, 'add', 'worker.txt');
  runGitCommand(facts.executionRoot, 'commit', '-m', 'complete worker turn');
  runGitCommand(facts.executionRoot, 'push', '-u', 'origin', facts.branch);
  const pushedHead = runGitCommand(facts.executionRoot, 'rev-parse', 'HEAD');
  mkdirSync(join(facts.executionRoot, '.serena'));
  mkdirSync(join(facts.executionRoot, '.serena', 'memories'));
  writeFileSync(
    join(facts.executionRoot, '.serena', '.gitignore'),
    'project.yml\nproject.local.yml\nmemories/\n',
  );
  writeFileSync(join(facts.executionRoot, '.serena', 'project.yml'), 'project: sloop\n');
  writeFileSync(join(facts.executionRoot, '.serena', 'project.local.yml'), 'local: true\n');

  const recovered = recoverWorkspace({
    ...opts,

    runId: 'worker-87654321',

    branch: facts.branch,
  });

  assert.equal(recovered.headSha, pushedHead);
  assert.deepEqual(recovered.ownership, facts.ownership);
  const registration = JSON.parse(readFileSync(join(root, '.sloop', 'state.json'), 'utf8'))
    .workspaces[0];
  assert.equal(registration.headSha, pushedHead);
  assert.deepEqual(registration.ownership, facts.ownership);
  cleanupWorkspace(recovered, root);
  assert.equal(existsSync(facts.executionRoot), false);
  assert.equal(existsSync(join(facts.executionRoot, '.serena')), false);
  assert.equal(listWorkspaces(root).length, 0);
}, 30_000);

test('remote recovery rejects a workspace unrelated to the current base branch', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(options);
  const stateFile = join(root, '.sloop', 'state.json');
  writeFileSync(stateFile, '{"workspaces":[]}\n');
  runGitCommand(root, 'checkout', '--orphan', 'unrelated-base');
  runGitCommand(root, 'rm', '-rf', '.');
  writeFileSync(join(root, 'UNRELATED.md'), 'unrelated base\n');
  runGitCommand(root, 'add', '.');
  runGitCommand(root, 'commit', '-m', 'create unrelated base');
  runGitCommand(root, 'push', '--force', 'origin', 'unrelated-base:main');
  runGitCommand(root, 'fetch', 'origin', 'main');

  assert.equal(recoverWorkspace({ ...options, branch: facts.branch }), undefined);
  assert.equal(existsSync(facts.executionRoot), true);
}, 30_000);

test('lost local registration is reconstructed from Git and clean remote-owned worktrees are removable', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace } =
    await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const opts = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(opts);
  const stateFile = join(root, '.sloop', 'state.json');
  writeFileSync(stateFile, '{"workspaces":[]}\n');

  assert.deepEqual(recoverWorkspace({ ...opts, branch: facts.branch }), facts);
  cleanupWorkspace(facts, root);
  assert.equal(existsSync(facts.executionRoot), false);
}, 30_000);
