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

export type WorkspaceFacts = Readonly<{
  workspaceRoot: string;
  executionRoot: string;
  worktreeRoot?: string;
  branch: string;
  baseSha: string;
  headSha: string;
  ownership: Readonly<{ runId: string; issue: number; protocol: string }>;
}>;
export type WorkspaceOptions = Readonly<{
  mode?: 'checkout' | 'worktree';
  repositoryRoot: string;
  remote: string;
  baseBranch: string;
  branchPrefix: string;
  issue: number;
  runId: string;
  branch?: string;
  worktreeRoot?: string;
  stateFile?: string;
}>;
export type BranchReconciliation = Readonly<{
  aligned: boolean;
  diagnostic: string;
  localSha?: string;
  remoteSha?: string;
}>;
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
const serenaMetadata = new Set(['.serena/.gitignore', '.serena/project.yml']);
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
      names.some((name) => !['.gitignore', 'project.yml'].includes(name)) ||
      lines.some((line) => !expected.includes(line.slice(3)))
    )
      return undefined;
    for (const name of names) {
      const info = lstatSync(resolve(directory, name));
      if (!info.isFile() || info.isSymbolicLink()) return undefined;
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
  for (const path of paths) unlinkSync(resolve(entry.executionRoot, path));
  rmdirSync(directory);
  return true;
};

/* c8 ignore start -- exercised through real Git repositories by integration callers. */
export function reconcileBranch(
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
export function prepareCheckoutWorkspace(o: WorkspaceOptions): WorkspaceFacts {
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
export function prepareWorktreeWorkspace(o: WorkspaceOptions): WorkspaceFacts {
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
export function recoverWorkspace(o: WorkspaceOptions): WorkspaceFacts | undefined {
  const file = o.stateFile ?? resolve(o.repositoryRoot, '.sloop/state.json');
  const root = resolve(o.repositoryRoot);
  const parent = resolve(root, o.worktreeRoot ?? '.sloop/worktrees');
  const entries = read(file);
  const found = entries.find(
    (x) =>
      x.repositoryRoot === root &&
      x.workspaceRoot === root &&
      x.ownership.issue === o.issue &&
      x.ownership.protocol === 'sloop-workspace-v1' &&
      (x.ownership.runId === o.runId || (o.branch !== undefined && x.branch === o.branch)) &&
      inside(parent, x.executionRoot) &&
      existsSync(x.executionRoot) &&
      (o.branch === undefined || x.branch === o.branch),
  );
  if (found && found.headSha) {
    if (exactWorkspace(root, found)) return found;
    const live = registeredWorktree(root, found);
    if (
      !live ||
      live.branch !== found.branch ||
      live.head !== git(['rev-parse', `${found.branch}^{commit}`], root) ||
      !inside(parent, found.executionRoot) ||
      !onlyGeneratedSerenaMetadata(found)
    )
      return undefined;
    try {
      git(['merge-base', '--is-ancestor', found.baseSha, live.head], root);
      git(['merge-base', '--is-ancestor', found.headSha, live.head], root);
    } catch {
      return undefined;
    }
    const refreshed = { ...found, headSha: live.head };
    write(
      file,
      entries.map((entry) => (entry === found ? refreshed : entry)),
    );
    return refreshed;
  }

  // Remote manifests are the durable authority. Reconstruct a worktree from
  // Git when the local workspace registry was lost with state.json.
  if (!o.branch || o.branch === 'pending') return undefined;
  const live = worktrees(root).find((entry) => entry.branch === o.branch);
  if (
    !live ||
    !inside(parent, live.path) ||
    live.head !== git(['rev-parse', `${o.branch}^{commit}`], root)
  )
    return undefined;
  const baseSha = git(['rev-parse', `${o.remote}/${o.baseBranch}^{commit}`], root);
  try {
    git(['merge-base', '--is-ancestor', baseSha, live.head], root);
  } catch {
    return undefined;
  }
  return {
    workspaceRoot: root,
    executionRoot: live.path,
    worktreeRoot: parent,
    branch: o.branch,
    baseSha,
    headSha: live.head,
    ownership: { runId: o.runId, issue: o.issue, protocol: 'sloop-workspace-v1' },
  };
}
export function listWorkspaces(
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
export function clearWorkspaces(
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
export function cleanupWorkspace(
  facts: WorkspaceFacts,
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
): void {
  const root = resolve(repositoryRoot);
  const file = resolve(stateFile);
  const entry = read(file).find(
    (x) =>
      x.repositoryRoot === root &&
      x.executionRoot === facts.executionRoot &&
      x.branch === facts.branch &&
      x.baseSha === facts.baseSha &&
      x.ownership.runId === facts.ownership.runId &&
      x.ownership.issue === facts.ownership.issue &&
      x.ownership.protocol === facts.ownership.protocol,
  );
  if (!entry) {
    const parent = resolve(facts.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
    if (!inside(parent, facts.executionRoot)) throw new Error('unsafe worktree target');
    const live = worktrees(root).find(
      (candidate) =>
        resolve(candidate.path) === resolve(facts.executionRoot) &&
        candidate.branch === facts.branch &&
        candidate.head === facts.headSha,
    );
    const entry = { ...facts, repositoryRoot: root };
    if (!live || !removeGeneratedSerenaMetadata(entry) || !cleanWorktree(entry))
      throw new Error('remote-owned workspace could not be verified');
    git(['worktree', 'remove', facts.executionRoot], root);
    return;
  }
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!inside(parent, entry.executionRoot)) throw new Error('unsafe worktree target');
  if (!exactWorkspace(root, entry))
    throw new Error('workspace registration or facts could not be verified');
  if (!removeGeneratedSerenaMetadata(entry))
    throw new Error('workspace is dirty (untracked or modified files); refusing cleanup');
  if (!cleanWorktree(entry)) throw new Error('workspace is dirty; refusing cleanup');
  git(['worktree', 'remove', entry.executionRoot], root);
  write(
    file,
    read(file).filter(
      (x) =>
        !(
          x.repositoryRoot === entry.repositoryRoot &&
          x.executionRoot === entry.executionRoot &&
          x.branch === entry.branch &&
          x.baseSha === entry.baseSha &&
          x.ownership.runId === entry.ownership.runId &&
          x.ownership.issue === entry.ownership.issue &&
          x.ownership.protocol === entry.ownership.protocol
        ),
    ),
  );
}
