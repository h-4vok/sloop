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

test('recovery and cleanup preserve unknown untracked files and reject unmatched ownership', async () => {
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
  state.workspaces[0].headSha = 'not-a-commit';
  writeFileSync(stateFile, JSON.stringify(state));

  assert.equal(
    recoverWorkspace({ ...opts, runId: 'worker-other', branch: facts.branch }),
    undefined,
  );
  state.workspaces[0].headSha = facts.headSha;
  writeFileSync(stateFile, JSON.stringify(state));
  assert.equal(
    recoverWorkspace({ ...opts, runId: 'worker-other', branch: 'sloop/32-other' }),
    undefined,
  );
  mkdirSync(join(facts.executionRoot, '.serena'));
  mkdirSync(join(facts.executionRoot, '.serena', 'memories'));
  writeFileSync(
    join(facts.executionRoot, '.serena', '.gitignore'),
    'project.yml\nproject.local.yml\nmemories/\n',
  );
  writeFileSync(join(facts.executionRoot, '.serena', 'project.yml'), 'project: sloop\n');
  writeFileSync(join(facts.executionRoot, '.serena', 'project.local.yml'), 'local: true\n');
  writeFileSync(join(facts.executionRoot, '.serena', 'user.txt'), 'keep me\n');
  writeFileSync(join(facts.executionRoot, '.serena', 'memories', 'keep.md'), 'keep this too\n');

  assert.throws(() => cleanupWorkspace(facts, root), /untracked or modified files/);
  assert.equal(readFileSync(join(facts.executionRoot, '.serena', 'user.txt'), 'utf8'), 'keep me\n');
  assert.equal(existsSync(join(facts.executionRoot, '.serena', '.gitignore')), true);
  assert.equal(existsSync(join(facts.executionRoot, '.serena', 'project.local.yml')), true);
  assert.equal(existsSync(join(facts.executionRoot, '.serena', 'memories')), true);
  assert.equal(
    readFileSync(join(facts.executionRoot, '.serena', 'memories', 'keep.md'), 'utf8'),
    'keep this too\n',
  );
  assert.equal(listWorkspaces(root).length, 1);
}, 30_000);

test('cleanup rejects generated Serena directories containing files under ignored memories', async () => {
  const { prepareWorktreeWorkspace, cleanupWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(options);
  const serenaDirectory = join(facts.executionRoot, '.serena');
  mkdirSync(join(serenaDirectory, 'memories'), { recursive: true });
  writeFileSync(join(serenaDirectory, '.gitignore'), 'project.yml\nproject.local.yml\nmemories/\n');
  writeFileSync(join(serenaDirectory, 'project.yml'), 'project: sloop\n');
  writeFileSync(join(serenaDirectory, 'project.local.yml'), 'local: true\n');
  writeFileSync(join(serenaDirectory, 'memories', 'user.md'), 'keep this file\n');

  assert.throws(() => cleanupWorkspace(facts, root), /workspace is dirty/);
  assert.equal(existsSync(join(serenaDirectory, 'memories', 'user.md')), true);
}, 30_000);

test('cleanup preserves nested Serena data outside the generated metadata contract', async () => {
  const { prepareWorktreeWorkspace, cleanupWorkspace } = await loadWorkspaceModule();
  const root = createRepository();
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  const options = createWorkspaceOptions(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(options);
  const serenaDirectory = join(facts.executionRoot, '.serena');
  mkdirSync(join(serenaDirectory, 'nested'), { recursive: true });
  writeFileSync(join(serenaDirectory, '.gitignore'), 'project.yml\nproject.local.yml\nmemories/\n');
  writeFileSync(join(serenaDirectory, 'project.yml'), 'project: sloop\n');
  writeFileSync(join(serenaDirectory, 'project.local.yml'), 'local: true\n');

  assert.throws(() => cleanupWorkspace(facts, root), /workspace is dirty/);
  assert.equal(existsSync(join(serenaDirectory, 'nested')), true);
}, 30_000);
