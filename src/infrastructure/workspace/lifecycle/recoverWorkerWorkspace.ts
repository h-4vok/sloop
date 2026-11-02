import { resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';
import type { WorkspaceOptions } from '../WorkspaceOptions.js';
import { discoverGitWorktrees } from './discoverGitWorktrees.js';
import { matchesRecoveryOwnership } from './validateWorkspaceOwnership.js';
import { generatedSerenaPaths } from './serenaMetadata.js';
import { isInside, readWorkspaceState, runGit, writeWorkspaceState } from './workspaceState.js';
import type { GitWorktree, RegisteredWorkspace } from './workspaceState.js';

function hasAncestorCommits(root: string, ancestorShas: string[], liveHead: string): boolean {
  try {
    for (const sha of ancestorShas) runGit(['merge-base', '--is-ancestor', sha, liveHead], root);
    return true;
  } catch {
    return false;
  }
}

function matchesRegisteredWorktree(live: GitWorktree, entry: RegisteredWorkspace): boolean {
  return (
    live.branch === entry.branch &&
    live.head === runGit(['rev-parse', `${entry.branch}^{commit}`], entry.repositoryRoot)
  );
}

function recoverRegisteredWorkspace(
  root: string,
  parent: string,
  file: string,
  entries: RegisteredWorkspace[],
  entry: RegisteredWorkspace,
): WorkspaceFacts | undefined {
  const live = discoverGitWorktrees(root).find(
    (worktree) => resolve(worktree.path) === resolve(entry.executionRoot),
  );
  if (!isRegisteredWorktreeUsable(live, parent, entry)) return undefined;
  if (generatedSerenaPaths(entry) === undefined) return undefined;
  if (!hasAncestorCommits(root, [entry.baseSha, entry.headSha], live.head)) return undefined;
  const refreshed = { ...entry, headSha: live.head };
  writeWorkspaceState(
    file,
    entries.map((candidate) => (candidate === entry ? refreshed : candidate)),
  );
  return refreshed;
}

function isRegisteredWorktreeUsable(
  live: GitWorktree | undefined,
  parent: string,
  entry: RegisteredWorkspace,
): live is GitWorktree {
  return Boolean(
    live && matchesRegisteredWorktree(live, entry) && isInside(parent, entry.executionRoot),
  );
}

function matchesRemoteWorktree(
  live: GitWorktree,
  options: WorkspaceOptions,
  root: string,
  parent: string,
): boolean {
  return (
    live.branch === options.branch &&
    isInside(parent, live.path) &&
    live.head === runGit(['rev-parse', `${options.branch}^{commit}`], root)
  );
}

function recoverRemoteWorkspace(
  options: WorkspaceOptions,
  root: string,
  parent: string,
): WorkspaceFacts | undefined {
  if (!options.branch || options.branch === 'pending') return undefined;
  const live = discoverGitWorktrees(root).find((worktree) =>
    matchesRemoteWorktree(worktree, options, root, parent),
  );
  if (!live) return undefined;
  const baseSha = runGit(['rev-parse', `${options.remote}/${options.baseBranch}^{commit}`], root);
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

/** Recover an owned worktree from trusted state or its live remote branch. */
export function recoverWorkerWorkspace(options: WorkspaceOptions): WorkspaceFacts | undefined {
  const root = resolve(options.repositoryRoot);
  const parent = resolve(root, options.worktreeRoot ?? '.sloop/worktrees');
  const file = options.stateFile ?? resolve(root, '.sloop/state.json');
  const entries = readWorkspaceState(file);
  const entry = entries.find((candidate) => matchesRecoveryOwnership(candidate, options, root));
  if (entry) return recoverExistingWorkspace(root, parent, file, entries, entry);
  return recoverRemoteWorkspace(options, root, parent);
}

function recoverExistingWorkspace(
  root: string,
  parent: string,
  file: string,
  entries: RegisteredWorkspace[],
  entry: RegisteredWorkspace,
): WorkspaceFacts | undefined {
  if (isCurrentRegistration(root, entry)) return entry;
  return recoverRegisteredWorkspace(root, parent, file, entries, entry);
}

function isCurrentRegistration(root: string, entry: RegisteredWorkspace): boolean {
  if (!entry.headSha || !entry.executionRoot || !entry.branch) return false;
  const live = discoverGitWorktrees(root).find(
    (worktree) => resolve(worktree.path) === resolve(entry.executionRoot),
  );
  return live?.head === entry.headSha && live.branch === entry.branch;
}
