import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = () => import('../dist/workspace.js');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-workspace-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  return root;
};
const options = (root, extra = {}) => ({
  repositoryRoot: root,
  remote: 'origin',
  baseBranch: 'main',
  branchPrefix: 'sloop/',
  issue: 32,
  runId: 'run-12345678',
  ...extra,
});

test('checkout preparation uses the configured base SHA and rejects dirty trees', async () => {
  const { prepareCheckoutWorkspace } = await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const facts = prepareCheckoutWorkspace(options(root));
  assert.equal(facts.baseSha, git(root, 'rev-parse', 'origin/main'));
  assert.equal(facts.headSha, facts.baseSha);
  assert.match(facts.branch, /^sloop\/32-[0-9a-f]{4}$/);
  writeFileSync(join(root, 'dirty.txt'), 'do not discard');
  assert.throws(() => prepareCheckoutWorkspace(options(root, { issue: 33 })), /dirty\.txt/);
});

test('worktree preparation persists facts, supports recovery, listing, and cleanup', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, listWorkspaces, cleanupWorkspace } =
    await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const customRoot = join(root, 'isolated');
  const opts = options(root, { worktreeRoot: customRoot });
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
});

test('recovery and cleanup use the persisted base when the remote advances', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace, listWorkspaces } =
    await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const opts = options(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(opts);

  git(root, 'checkout', 'main');
  writeFileSync(join(root, 'advanced.txt'), 'advanced\n');
  git(root, 'add', 'advanced.txt');
  git(root, 'commit', '-m', 'advance remote base');
  git(root, 'push', 'origin', 'main');

  assert.equal(recoverWorkspace(opts).baseSha, facts.baseSha);
  cleanupWorkspace(facts, root);
  assert.equal(listWorkspaces(root).length, 0);
});

test('branch collisions regenerate a unique name and clear removes only owned worktrees', async () => {
  const { prepareWorktreeWorkspace, clearWorkspaces, listWorkspaces } = await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const first = prepareWorktreeWorkspace(options(root));
  const second = prepareWorktreeWorkspace(options(root, { runId: 'run-87654321' }));
  assert.notEqual(second.branch, first.branch);
  assert.equal(listWorkspaces(root).length, 2);
  clearWorkspaces(root);
  assert.equal(listWorkspaces(root).length, 0);
});

test('recovery and cleanup fail closed for fake or dirty registered targets', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace, listWorkspaces } =
    await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const opts = options(root, { worktreeRoot: join(root, 'isolated') });
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
});

test('lost local registration is reconstructed from Git and clean remote-owned worktrees are removable', async () => {
  const { prepareWorktreeWorkspace, recoverWorkspace, cleanupWorkspace } = await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const opts = options(root, { worktreeRoot: join(root, 'isolated') });
  const facts = prepareWorktreeWorkspace(opts);
  const stateFile = join(root, '.sloop', 'state.json');
  writeFileSync(stateFile, '{"workspaces":[]}\n');
  assert.deepEqual(recoverWorkspace({ ...opts, branch: facts.branch }), facts);
  cleanupWorkspace(facts, root);
  assert.equal(existsSync(facts.executionRoot), false);
});

test('clear retains registrations whose Git ancestry cannot be verified', async () => {
  const { prepareWorktreeWorkspace, clearWorkspaces, listWorkspaces } = await workspace();
  const root = repo();
  const remote = mkdtempSync(join(tmpdir(), 'sloop-remote-'));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const facts = prepareWorktreeWorkspace(options(root, { worktreeRoot: join(root, 'isolated') }));
  const stateFile = join(root, '.sloop', 'state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.workspaces[0].baseSha = 'not-a-commit';
  writeFileSync(stateFile, JSON.stringify(state));
  clearWorkspaces(root);
  assert.equal(listWorkspaces(root).length, 1);
  assert.equal(existsSync(facts.executionRoot), true);
});
