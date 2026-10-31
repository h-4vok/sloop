import { resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';
import { discoverGitWorktrees } from './discoverGitWorktrees.js';
import {
  isExactWorkspace,
  matchesLiveWorkspace,
  matchesWorkspaceFacts,
} from './validateWorkspaceOwnership.js';
import { removeGeneratedSerenaMetadata } from './serenaMetadata.js';
import { isInside, readWorkspaceState, runGit, writeWorkspaceState } from './workspaceState.js';
import type { RegisteredWorkspace } from './workspaceState.js';

function isCleanWorkspace(entry: RegisteredWorkspace): boolean {
  return runGit(['status', '--porcelain=v1'], entry.executionRoot) === '';
}

function clearableWorkspace(root: string, entry: RegisteredWorkspace): boolean {
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  return (
    hasSloopWorkspaceOwner(root, entry) &&
    isInside(parent, entry.executionRoot) &&
    isExactWorkspace(root, entry) &&
    isCleanWorkspace(entry)
  );
}

function hasSloopWorkspaceOwner(root: string, entry: RegisteredWorkspace): boolean {
  return (
    Boolean(entry?.ownership) &&
    entry.repositoryRoot === root &&
    entry.ownership.protocol === 'sloop-workspace-v1'
  );
}

/** Remove only registered worktrees whose ownership, ancestry, and cleanliness verify. */
export function clearOwnedWorkspaces(
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
): void {
  const root = resolve(repositoryRoot);
  const keep: RegisteredWorkspace[] = [];
  for (const entry of readWorkspaceState(stateFile)) {
    if (!clearableWorkspace(root, entry)) {
      keep.push(entry);
      continue;
    }
    runGit(['worktree', 'remove', entry.executionRoot], root);
  }
  writeWorkspaceState(stateFile, keep);
}

function cleanAfterMetadataRemoval(entry: RegisteredWorkspace): boolean {
  return removeGeneratedSerenaMetadata(entry) && isCleanWorkspace(entry);
}

function cleanupRegisteredWorkspace(entry: RegisteredWorkspace, file: string, root: string): void {
  validateRegisteredWorkspaceForCleanup(entry, root);
  runGit(['worktree', 'remove', entry.executionRoot], root);
  writeWorkspaceState(
    file,
    readWorkspaceState(file).filter((candidate) => !matchesWorkspaceFacts(candidate, entry, root)),
  );
}

function validateRegisteredWorkspaceForCleanup(entry: RegisteredWorkspace, root: string): void {
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  assertWorkspaceInside(parent, entry.executionRoot);
  assertWorkspaceIdentity(root, entry);
  assertWorkspaceMetadataSafe(entry);
  assertWorkspaceClean(entry);
}

function assertWorkspaceInside(parent: string, executionRoot: string): void {
  if (!isInside(parent, executionRoot)) throw new Error('unsafe worktree target');
}

function assertWorkspaceIdentity(root: string, entry: RegisteredWorkspace): void {
  if (!isExactWorkspace(root, entry))
    throw new Error('workspace registration or facts could not be verified');
}

function assertWorkspaceMetadataSafe(entry: RegisteredWorkspace): void {
  if (!removeGeneratedSerenaMetadata(entry))
    throw new Error('workspace is dirty (untracked or modified files); refusing cleanup');
}

function assertWorkspaceClean(entry: RegisteredWorkspace): void {
  if (!isCleanWorkspace(entry)) throw new Error('workspace is dirty; refusing cleanup');
}

function cleanupRemoteWorkspace(facts: WorkspaceFacts, root: string): void {
  const parent = resolve(facts.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!isInside(parent, facts.executionRoot)) throw new Error('unsafe worktree target');
  const live = discoverGitWorktrees(root).find((candidate) =>
    matchesLiveWorkspace(candidate, facts),
  );
  const entry: RegisteredWorkspace = { ...facts, repositoryRoot: root };
  if (!isVerifiedRemoteWorkspace(live !== undefined, root, entry))
    throw new Error('remote-owned workspace could not be verified');
  runGit(['worktree', 'remove', facts.executionRoot], root);
}

function isVerifiedRemoteWorkspace(
  isLive: boolean,
  root: string,
  entry: RegisteredWorkspace,
): boolean {
  return isLive && isExactWorkspace(root, entry) && cleanAfterMetadataRemoval(entry);
}

/** Remove one workspace only after proving its persisted ownership and target. */
export function cleanupOwnedWorkspace(
  facts: WorkspaceFacts,
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
): void {
  const root = resolve(repositoryRoot);
  const file = resolve(stateFile);
  const entry = readWorkspaceState(file).find((candidate) =>
    matchesWorkspaceFacts(candidate, facts, root),
  );
  if (entry) {
    cleanupRegisteredWorkspace(entry, file, root);
    return;
  }
  cleanupRemoteWorkspace(facts, root);
}
