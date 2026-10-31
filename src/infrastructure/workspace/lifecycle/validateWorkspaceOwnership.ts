import { resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';
import type { WorkspaceOptions } from '../WorkspaceOptions.js';
import { discoverGitWorktrees } from './discoverGitWorktrees.js';
import { isInside, runGit } from './workspaceState.js';
import type { GitWorktree, RegisteredWorkspace } from './workspaceState.js';

/** Confirm the live branch, head, base ancestry, and registered target all agree. */
export function isExactWorkspace(root: string, entry: RegisteredWorkspace): boolean {
  const live = discoverGitWorktrees(root).find(
    (worktree) => resolve(worktree.path) === resolve(entry.executionRoot),
  );
  if (!matchesRegisteredHead(live, entry)) return false;
  try {
    return registeredRefsMatch(root, entry);
  } catch {
    return false;
  }
}

function matchesRegisteredHead(live: GitWorktree | undefined, entry: RegisteredWorkspace): boolean {
  return Boolean(live && live.branch === entry.branch && live.head === entry.headSha);
}

function registeredRefsMatch(root: string, entry: RegisteredWorkspace): boolean {
  const registeredHead = runGit(['rev-parse', `${entry.branch}^{commit}`], root);
  const baseIsAncestor = runGit(
    ['merge-base', '--is-ancestor', entry.baseSha, entry.headSha],
    root,
  );
  return registeredHead === entry.headSha && baseIsAncestor === '';
}

/** Match persisted location and ownership facts before registered cleanup. */
export function matchesWorkspaceFacts(
  entry: RegisteredWorkspace,
  facts: WorkspaceFacts,
  root: string,
): boolean {
  if (!entry.ownership) return false;
  return [
    entry.repositoryRoot === root,
    entry.executionRoot === facts.executionRoot,
    entry.branch === facts.branch,
    entry.baseSha === facts.baseSha,
    entry.ownership.runId === facts.ownership.runId,
    entry.ownership.issue === facts.ownership.issue,
    entry.ownership.protocol === facts.ownership.protocol,
  ].every(Boolean);
}

/** Validate registration ownership and strict worktree containment for recovery. */
export function matchesRecoveryOwnership(
  entry: RegisteredWorkspace,
  options: WorkspaceOptions,
  root: string,
): boolean {
  if (!entry.ownership) return false;
  const expectedParent = resolve(root, options.worktreeRoot ?? '.sloop/worktrees');
  return [
    isRepositoryWorkspace(entry, root),
    hasMatchingIssueProtocol(entry, options),
    matchesRunOrBranch(entry, options),
    matchesRequestedBranch(entry, options),
    isInside(expectedParent, entry.executionRoot),
  ].every(Boolean);
}

function isRepositoryWorkspace(entry: RegisteredWorkspace, root: string): boolean {
  return Boolean(entry?.ownership) && entry.repositoryRoot === root && entry.workspaceRoot === root;
}

function hasMatchingIssueProtocol(entry: RegisteredWorkspace, options: WorkspaceOptions): boolean {
  return (
    entry.ownership.issue === options.issue && entry.ownership.protocol === 'sloop-workspace-v1'
  );
}

function matchesRunOrBranch(entry: RegisteredWorkspace, options: WorkspaceOptions): boolean {
  return (
    entry.ownership.runId === options.runId ||
    (options.branch !== undefined && entry.branch === options.branch)
  );
}

function matchesRequestedBranch(entry: RegisteredWorkspace, options: WorkspaceOptions): boolean {
  return options.branch === undefined || entry.branch === options.branch;
}

/** Match a live worktree against the exact persisted path, branch, and head. */
export function matchesLiveWorkspace(live: GitWorktree, facts: WorkspaceFacts): boolean {
  return (
    resolve(live.path) === resolve(facts.executionRoot) &&
    live.branch === facts.branch &&
    live.head === facts.headSha
  );
}
