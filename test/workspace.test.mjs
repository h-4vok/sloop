import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const loadWorkspaceModule = async () => {
  const { workspaceAdapter } = await import('../src/workspace.ts');

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
  const workspaceModule = await import('../src/workspace.ts');

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
}, 15_000);

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
});

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
