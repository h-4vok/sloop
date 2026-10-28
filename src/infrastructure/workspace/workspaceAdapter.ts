import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { BranchReconciliation } from './BranchReconciliation.js';
import type { WorkspaceFacts } from './WorkspaceFacts.js';
import type { WorkspaceOptions } from './WorkspaceOptions.js';
type Registered = WorkspaceFacts & {
  repositoryRoot: string;
  worktreeRoot?: string;
  pr?: number;
  orphaned?: boolean;
};
const git = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
type GitWorktree = { path: string; head: string; branch?: string };
const worktrees = (root: string): GitWorktree[] => {
  const output = git(['worktree', 'list', '--porcelain'], root);
  const result: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      if (current.path && current.head) result.push(current as GitWorktree);
      current = {};
    } else if (line.startsWith('worktree ')) current.path = resolve(line.slice(9));
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch '))
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  if (current.path && current.head) result.push(current as GitWorktree);
  return result;
};
const registeredWorktree = (root: string, entry: Registered): GitWorktree | undefined =>
  worktrees(root).find((x) => resolve(x.path) === resolve(entry.executionRoot));
const exactWorkspace = (root: string, entry: Registered): boolean => {
  const live = registeredWorktree(root, entry);
  if (!live || live.branch !== entry.branch || live.head !== entry.headSha) return false;
  try {
    return (
      git(['rev-parse', `${entry.branch}^{commit}`], root) === entry.headSha &&
      git(['merge-base', '--is-ancestor', entry.baseSha, entry.headSha], root) === ''
    );
  } catch {
    return false;
  }
};
const cleanWorktree = (entry: Registered) =>
  git(['status', '--porcelain=v1'], entry.executionRoot) === '';
const serenaMetadata = new Set([
  '.serena/.gitignore',
  '.serena/project.yml',
  '.serena/project.local.yml',
]);
const onlyGeneratedSerenaMetadata = (entry: Registered): string[] | undefined => {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], entry.executionRoot);
  const lines = status ? status.split(/\r?\n/) : [];
  if (!lines.every((line) => line.startsWith('?? ') && serenaMetadata.has(line.slice(3))))
    return undefined;
  const directory = resolve(entry.executionRoot, '.serena');
  try {
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return undefined;
    const names = readdirSync(directory).sort();
    const expected = names.map((name) => `.serena/${name}`);
    if (
      names.some(
        (name) => !['.gitignore', 'project.yml', 'project.local.yml', 'memories'].includes(name),
      ) ||
      lines.some((line) => !expected.includes(line.slice(3)))
    )
      return undefined;
    for (const name of names) {
      const path = resolve(directory, name);
      const info = lstatSync(path);
      if (name === 'memories') {
        if (!info.isDirectory() || info.isSymbolicLink() || readdirSync(path).length !== 0)
          return undefined;
      } else if (!info.isFile() || info.isSymbolicLink()) return undefined;
    }
  } catch {
    return lines.length === 0 && !existsSync(directory) ? [] : undefined;
  }
  return readdirSync(directory).map((name) => `.serena/${name}`);
};
const removeGeneratedSerenaMetadata = (entry: Registered): boolean => {
  const paths = onlyGeneratedSerenaMetadata(entry);
  if (paths === undefined) return false;
  if (!paths.length) return true;
  const directory = resolve(entry.executionRoot, '.serena');
  for (const path of paths) {
    if (path === '.serena/memories') rmdirSync(resolve(entry.executionRoot, path));
    else unlinkSync(resolve(entry.executionRoot, path));
  }
  rmdirSync(directory);
  return true;
};

/* c8 ignore start -- exercised through real Git repositories by integration callers. */
function reconcileBranch(
  branch: string,
  remote = 'origin',
  baseBranch = 'main',
  root = process.cwd(),
): BranchReconciliation {
  try {
    const expected = branch;
    const current = git(['symbolic-ref', '--short', 'HEAD'], root);
    if (current !== expected)
      return {
        aligned: false,

        diagnostic: `local checkout is on ${current}, expected ${expected}`,
      };
    const dirty = git(['status', '--porcelain=v1'], root);
    if (dirty) return { aligned: false, diagnostic: 'uncommitted local work remains' };
    const localSha = git(['rev-parse', 'HEAD^{commit}'], root);
    const remoteSha = git(['rev-parse', `${remote}/${expected}^{commit}`], root);
    const [behind, ahead] = git(
      ['rev-list', '--left-right', '--count', `${remote}/${expected}...HEAD`],
      root,
    )
      .split(/\s+/)
      .map(Number);
    if (behind !== 0 || ahead !== 0)
      return {
        aligned: false,

        diagnostic: `local branch diverges from ${remote}/${expected} (ahead=${ahead}, behind=${behind})`,

        localSha,

        remoteSha,
      };
    try {
      git(['merge-base', '--is-ancestor', `${remote}/${baseBranch}`, 'HEAD'], root);
    } catch {
      return {
        aligned: false,

        diagnostic: `branch is not based on ${remote}/${baseBranch}`,

        localSha,

        remoteSha,
      };
    }
    return { aligned: true, diagnostic: 'branch is clean and aligned', localSha, remoteSha };
  } catch (error) {
    return {
      aligned: false,

      diagnostic: `could not verify local/remote branch: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
/* c8 ignore stop */
const inside = (root: string, target: string) => {
  const r = relative(resolve(root), resolve(target));
  return r !== '' && r !== '..' && !r.startsWith(`..${requireSep()}`) && !isAbsolute(r);
};
const requireSep = () => (process.platform === 'win32' ? '\\' : '/');
const read = (file: string): Registered[] => {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { workspaces?: Registered[] };
    return value.workspaces ?? [];
  } catch {
    return [];
  }
};
const write = (file: string, entries: Registered[]) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ workspaces: entries }, null, 2) + '\n');
  renameSync(tmp, file);
};
const branch = (prefix: string, issue: number, root: string) => {
  for (;;) {
    const name = `${prefix}${issue}-${randomUUID().slice(0, 4)}`;
    try {
      git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], root);
    } catch {
      return name;
    }
  }
};
function prepareCheckoutWorkspace(o: WorkspaceOptions): WorkspaceFacts {
  const root = resolve(o.repositoryRoot);
  const dirty = git(['status', '--porcelain=v1'], root);
  if (dirty) throw new Error(`working tree is dirty; refusing workspace preparation:\n${dirty}`);
  git(['checkout', o.baseBranch], root);
  git(['pull', '--ff-only', o.remote, o.baseBranch], root);
  git(['fetch', o.remote, o.baseBranch], root);
  const baseSha = git(['rev-parse', `${o.remote}/${o.baseBranch}^{commit}`], root);
  const name = branch(o.branchPrefix, o.issue, root);
  git(['checkout', '-b', name, baseSha], root);
  return {
    workspaceRoot: root,

    executionRoot: root,

    branch: name,

    baseSha,

    headSha: baseSha,

    ownership: { runId: o.runId, issue: o.issue, protocol: 'sloop-workspace-v1' },
  };
}
function prepareWorktreeWorkspace(o: WorkspaceOptions): WorkspaceFacts {
  const root = resolve(o.repositoryRoot),
    parent = resolve(root, o.worktreeRoot ?? '.sloop/worktrees');
  git(['fetch', o.remote, o.baseBranch], root);
  const baseSha = git(['rev-parse', `${o.remote}/${o.baseBranch}^{commit}`], root);
  const name = branch(o.branchPrefix, o.issue, root),
    executionRoot = resolve(parent, `${o.issue}-${o.runId.slice(0, 8)}`);
  if (!inside(parent, executionRoot)) throw new Error('unsafe worktree target');
  if (existsSync(executionRoot))
    throw new Error(`worktree target already exists: ${executionRoot}`);
  mkdirSync(parent, { recursive: true });
  git(['worktree', 'add', '-b', name, executionRoot, baseSha], root);
  const facts = {
    workspaceRoot: root,

    executionRoot,

    worktreeRoot: parent,

    branch: name,

    baseSha,

    headSha: baseSha,

    ownership: { runId: o.runId, issue: o.issue, protocol: 'sloop-workspace-v1' },
  };
  const file = o.stateFile ?? resolve(root, '.sloop/state.json');
  write(file, [...read(file), { ...facts, repositoryRoot: root, worktreeRoot: parent }]);
  return facts;
}
function recoverWorkspace(o: WorkspaceOptions): WorkspaceFacts | undefined {
  const file = o.stateFile ?? resolve(o.repositoryRoot, '.sloop/state.json');
  const root = resolve(o.repositoryRoot);
  const parent = resolve(root, o.worktreeRoot ?? '.sloop/worktrees');
  const entries = read(file);
  const found = findRegisteredWorkspace(entries, o, root, parent);
  if (found?.headSha) return recoverRegisteredWorkspace(found, entries, file, root, parent);

  return recoverRemoteWorkspace(o, root, parent);
}

function findRegisteredWorkspace(
  entries: Registered[],
  options: WorkspaceOptions,
  root: string,
  parent: string,
): Registered | undefined {
  return entries.find(
    (entry) =>
      matchesRecoveryOwnership(entry, options, root) &&
      inside(parent, entry.executionRoot) &&
      existsSync(entry.executionRoot),
  );
}

function matchesRecoveryOwnership(
  entry: Registered,
  options: WorkspaceOptions,
  root: string,
): boolean {
  return (
    matchesRecoveryRepository(entry, options, root) &&
    matchesRecoveryRun(entry, options) &&
    matchesRequestedBranch(entry, options)
  );
}

function matchesRecoveryRepository(
  entry: Registered,
  options: WorkspaceOptions,
  root: string,
): boolean {
  return (
    entry.repositoryRoot === root &&
    entry.workspaceRoot === root &&
    entry.ownership.issue === options.issue &&
    entry.ownership.protocol === 'sloop-workspace-v1'
  );
}

function matchesRecoveryRun(entry: Registered, options: WorkspaceOptions): boolean {
  return (
    entry.ownership.runId === options.runId ||
    (options.branch !== undefined && entry.branch === options.branch)
  );
}

function matchesRequestedBranch(entry: Registered, options: WorkspaceOptions): boolean {
  return options.branch === undefined || entry.branch === options.branch;
}

function recoverRegisteredWorkspace(
  found: Registered,
  entries: Registered[],
  file: string,
  root: string,
  parent: string,
): WorkspaceFacts | undefined {
  if (exactWorkspace(root, found)) return found;

  const live = getRecoverableRegisteredWorktree(root, parent, found);
  if (!live) return undefined;

  const refreshed = { ...found, headSha: live.head };
  write(
    file,
    entries.map((entry) => (entry === found ? refreshed : entry)),
  );
  return refreshed;
}

function getRecoverableRegisteredWorktree(
  root: string,
  parent: string,
  found: Registered,
): GitWorktree | undefined {
  const live = registeredWorktree(root, found);
  if (!live || !matchesRegisteredWorktree(live, found)) return undefined;
  if (!hasSafeGeneratedWorkspacePath(parent, found)) return undefined;
  if (!hasAncestorCommits(root, [found.baseSha, found.headSha], live.head)) return undefined;

  return live;
}

function matchesRegisteredWorktree(live: GitWorktree, found: Registered): boolean {
  return (
    live.branch === found.branch &&
    live.head === git(['rev-parse', `${found.branch}^{commit}`], found.repositoryRoot)
  );
}

function hasSafeGeneratedWorkspacePath(parent: string, found: Registered): boolean {
  return inside(parent, found.executionRoot) && onlyGeneratedSerenaMetadata(found) !== undefined;
}

function hasAncestorCommits(root: string, ancestorShas: string[], liveHead: string): boolean {
  try {
    for (const ancestorSha of ancestorShas) {
      git(['merge-base', '--is-ancestor', ancestorSha, liveHead], root);
    }

    return true;
  } catch {
    return false;
  }
}

// Remote manifests remain authoritative when local state.json is missing.
function recoverRemoteWorkspace(
  options: WorkspaceOptions,
  root: string,
  parent: string,
): WorkspaceFacts | undefined {
  if (!options.branch || options.branch === 'pending') return undefined;

  const live = worktrees(root).find((entry) =>
    matchesRemoteWorkspace(entry, options, root, parent),
  );
  if (!live) return undefined;

  const baseSha = git(['rev-parse', `${options.remote}/${options.baseBranch}^{commit}`], root);
  if (!hasAncestorCommits(root, [baseSha], live.head)) return undefined;

  return {
    workspaceRoot: root,

    executionRoot: live.path,

    worktreeRoot: parent,

    branch: options.branch,

    baseSha,

    headSha: live.head,

    ownership: { runId: options.runId, issue: options.issue, protocol: 'sloop-workspace-v1' },
  };
}

function matchesRemoteWorkspace(
  live: GitWorktree,
  options: WorkspaceOptions,
  root: string,
  parent: string,
): boolean {
  return (
    live.branch === options.branch &&
    inside(parent, live.path) &&
    live.head === git(['rev-parse', `${options.branch}^{commit}`], root)
  );
}

function listWorkspaces(
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
) {
  return read(stateFile)
    .filter((x) => x.repositoryRoot === resolve(repositoryRoot))
    .map((x) => ({
      path: x.executionRoot,

      branch: x.branch,

      issue: x.ownership.issue,

      pr: x.pr ?? '—',
    }));
}
function clearWorkspaces(
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
) {
  const root = resolve(repositoryRoot),
    entries = read(stateFile),
    keep: Registered[] = [];
  for (const x of entries) {
    if (
      x.repositoryRoot !== root ||
      x.ownership.protocol !== 'sloop-workspace-v1' ||
      !inside(resolve(x.worktreeRoot ?? resolve(root, '.sloop/worktrees')), x.executionRoot) ||
      !existsSync(x.executionRoot) ||
      !exactWorkspace(root, x) ||
      !cleanWorktree(x)
    ) {
      keep.push(x);
      continue;
    }
    git(['worktree', 'remove', x.executionRoot], root);
  }
  write(stateFile, keep);
}

/** Remove one workspace only after proving its persisted ownership and target. */
function cleanupWorkspace(
  facts: WorkspaceFacts,
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
): void {
  const root = resolve(repositoryRoot);
  const file = resolve(stateFile);
  const entry = read(file).find((candidate) => matchesCleanupFacts(candidate, facts, root));

  if (entry) {
    cleanupRegisteredWorkspace(entry, file, root);
    return;
  }

  cleanupRemoteWorkspace(facts, root);
}

function matchesCleanupFacts(entry: Registered, facts: WorkspaceFacts, root: string): boolean {
  return matchesCleanupLocation(entry, facts, root) && matchesCleanupOwnership(entry, facts);
}

function matchesCleanupLocation(entry: Registered, facts: WorkspaceFacts, root: string): boolean {
  return (
    entry.repositoryRoot === root &&
    entry.executionRoot === facts.executionRoot &&
    entry.branch === facts.branch &&
    entry.baseSha === facts.baseSha
  );
}

function matchesCleanupOwnership(entry: Registered, facts: WorkspaceFacts): boolean {
  return (
    entry.ownership.runId === facts.ownership.runId &&
    entry.ownership.issue === facts.ownership.issue &&
    entry.ownership.protocol === facts.ownership.protocol
  );
}

function cleanupRemoteWorkspace(facts: WorkspaceFacts, root: string): void {
  const parent = resolve(facts.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!inside(parent, facts.executionRoot)) throw new Error('unsafe worktree target');

  const live = worktrees(root).find((candidate) => matchesCleanupWorktree(candidate, facts));
  const entry = { ...facts, repositoryRoot: root };
  if (!live || !removeGeneratedSerenaMetadata(entry) || !cleanWorktree(entry)) {
    throw new Error('remote-owned workspace could not be verified');
  }

  git(['worktree', 'remove', facts.executionRoot], root);
}

function matchesCleanupWorktree(candidate: GitWorktree, facts: WorkspaceFacts): boolean {
  return (
    resolve(candidate.path) === resolve(facts.executionRoot) &&
    candidate.branch === facts.branch &&
    candidate.head === facts.headSha
  );
}

function cleanupRegisteredWorkspace(entry: Registered, file: string, root: string): void {
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!inside(parent, entry.executionRoot)) throw new Error('unsafe worktree target');
  if (!exactWorkspace(root, entry)) {
    throw new Error('workspace registration or facts could not be verified');
  }
  if (!removeGeneratedSerenaMetadata(entry)) {
    throw new Error('workspace is dirty (untracked or modified files); refusing cleanup');
  }
  if (!cleanWorktree(entry)) throw new Error('workspace is dirty; refusing cleanup');

  git(['worktree', 'remove', entry.executionRoot], root);
  write(
    file,
    read(file).filter((candidate) => !matchesCleanupFacts(candidate, entry, root)),
  );
}

/** Git and filesystem operations for preparing and managing owned workspaces. */
export const workspaceAdapter = Object.freeze({
  reconcileBranch,

  prepareCheckoutWorkspace,

  prepareWorktreeWorkspace,

  recoverWorkspace,

  listWorkspaces,

  clearWorkspaces,

  cleanupWorkspace,
});
