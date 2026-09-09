import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export type WorkspaceFacts = Readonly<{
  workspaceRoot: string;
  executionRoot: string;
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
  worktreeRoot?: string;
  stateFile?: string;
}>;
type Registered = WorkspaceFacts & {
  repositoryRoot: string;
  worktreeRoot?: string;
  pr?: number;
  orphaned?: boolean;
};
const git = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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
  const found = read(file).find(
    (x) =>
      x.repositoryRoot === root &&
      x.ownership.runId === o.runId &&
      x.ownership.issue === o.issue &&
      x.ownership.protocol === 'sloop-workspace-v1' &&
      x.baseSha === git(['rev-parse', `${o.remote}/${o.baseBranch}^{commit}`], root) &&
      (o.worktreeRoot === undefined || inside(parent, x.executionRoot)) &&
      (o.worktreeRoot === undefined || existsSync(x.executionRoot)),
  );
  return found && found.headSha ? found : undefined;
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
      !existsSync(x.executionRoot)
    ) {
      keep.push(x);
      continue;
    }
    git(['worktree', 'remove', '--force', x.executionRoot], root);
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
  if (!entry) throw new Error('workspace ownership could not be verified');
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!inside(parent, entry.executionRoot)) throw new Error('unsafe worktree target');
  git(['worktree', 'remove', '--force', entry.executionRoot], root);
  write(
    file,
    read(file).filter((x) => x !== entry),
  );
}
