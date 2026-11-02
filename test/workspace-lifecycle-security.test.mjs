import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';

const runGitCommand = (repository, ...args) =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();

function createLocalWorkspaceFixture() {
  const repository = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lifecycle-'));
  runGitCommand(repository, 'init', '-b', 'main');
  runGitCommand(repository, 'config', 'user.email', 'test@example.com');
  runGitCommand(repository, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(repository, 'README.md'), 'base\n');
  runGitCommand(repository, 'add', '.');
  runGitCommand(repository, 'commit', '-m', 'base');

  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lifecycle-remote-'));
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(repository, 'remote', 'add', 'origin', remote);
  runGitCommand(repository, 'push', '-u', 'origin', 'main');
  return { repository, worktreeRoot: join(repository, 'isolated') };
}

test('stale recovery rejects unknown Serena files and cleanup preserves them', async () => {
  const { workspaceAdapter } = await import('../src/workspace.ts');
  const fixture = createLocalWorkspaceFixture();
  const options = {
    repositoryRoot: fixture.repository,
    worktreeRoot: fixture.worktreeRoot,
    remote: 'origin',
    baseBranch: 'main',
    branchPrefix: 'sloop/',
    issue: 138,
    runId: 'dispatch-12345678',
  };

  const facts = workspaceAdapter.prepareWorktreeWorkspace(options);
  writeFileSync(join(facts.executionRoot, 'worker.txt'), 'completed work\n');
  runGitCommand(facts.executionRoot, 'add', 'worker.txt');
  runGitCommand(facts.executionRoot, 'commit', '-m', 'complete worker turn');
  runGitCommand(facts.executionRoot, 'push', '-u', 'origin', facts.branch);
  mkdirSync(join(facts.executionRoot, '.serena'));
  writeFileSync(join(facts.executionRoot, '.serena', 'private.txt'), 'preserve\n');
  const stateFile = join(fixture.repository, '.sloop', 'state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.workspaces[0].headSha = facts.baseSha;
  writeFileSync(stateFile, JSON.stringify(state));

  const recovered = workspaceAdapter.recoverWorkspace({
    ...options,
    runId: 'worker-87654321',
    branch: facts.branch,
  });

  assert.equal(recovered, undefined);
  assert.throws(
    () => workspaceAdapter.cleanupWorkspace(facts, fixture.repository),
    /could not be verified/,
  );
  assert.equal(
    readFileSync(join(facts.executionRoot, '.serena', 'private.txt'), 'utf8'),
    'preserve\n',
  );
}, 20_000);

test('unregistered cleanup rejects worktrees without verified base ancestry', async () => {
  const { workspaceAdapter } = await import('../src/workspace.ts');
  const fixture = createLocalWorkspaceFixture();
  const options = {
    repositoryRoot: fixture.repository,
    worktreeRoot: fixture.worktreeRoot,
    remote: 'origin',
    baseBranch: 'main',
    branchPrefix: 'sloop/',
    issue: 138,
    runId: 'dispatch-12345678',
  };
  const facts = workspaceAdapter.prepareWorktreeWorkspace(options);
  const stateFile = join(fixture.repository, '.sloop', 'state.json');
  writeFileSync(stateFile, JSON.stringify({ workspaces: [] }));

  assert.throws(
    () =>
      workspaceAdapter.cleanupWorkspace({ ...facts, baseSha: 'not-a-commit' }, fixture.repository),
    /could not be verified/,
  );
  assert.equal(existsSync(facts.executionRoot), true);
}, 20_000);
