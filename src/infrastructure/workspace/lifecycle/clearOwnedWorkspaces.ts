import { resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';
import { discoverGitWorktrees } from './discoverGitWorktrees.js';
import {
  isExactWorkspace,
  matchesLiveWorkspace,
  matchesWorkspaceFacts,
  removeGeneratedSerenaMetadata,
} from './validateWorkspaceOwnership.js';
import { isInside, readWorkspaceState, runGit, writeWorkspaceState } from './workspaceState.js';
import type { RegisteredWorkspace } from './workspaceState.js';

function isCleanWorkspace(entry: RegisteredWorkspace): boolean {
  return runGit(['status', '--porcelain=v1'], entry.executionRoot) === '';
}

function clearableWorkspace(root: string, entry: RegisteredWorkspace): boolean {
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  return (
    Boolean(entry?.ownership) &&
    entry.repositoryRoot === root &&
    entry.ownership.protocol === 'sloop-workspace-v1' &&
    isInside(parent, entry.executionRoot) &&
    isExactWorkspace(root, entry) &&
    isCleanWorkspace(entry)
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
  const parent = resolve(entry.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!isInside(parent, entry.executionRoot)) throw new Error('unsafe worktree target');
  if (!isExactWorkspace(root, entry))
    throw new Error('workspace registration or facts could not be verified');
  if (!removeGeneratedSerenaMetadata(entry))
    throw new Error('workspace is dirty (untracked or modified files); refusing cleanup');
  if (!isCleanWorkspace(entry)) throw new Error('workspace is dirty; refusing cleanup');
  runGit(['worktree', 'remove', entry.executionRoot], root);
  writeWorkspaceState(
    file,
    readWorkspaceState(file).filter((candidate) => !matchesWorkspaceFacts(candidate, entry, root)),
  );
}

function cleanupRemoteWorkspace(facts: WorkspaceFacts, root: string): void {
  const parent = resolve(facts.worktreeRoot ?? resolve(root, '.sloop/worktrees'));
  if (!isInside(parent, facts.executionRoot)) throw new Error('unsafe worktree target');
  const live = discoverGitWorktrees(root).find((candidate) =>
    matchesLiveWorkspace(candidate, facts),
  );
  const entry: RegisteredWorkspace = { ...facts, repositoryRoot: root };
  if (!live || !isExactWorkspace(root, entry) || !cleanAfterMetadataRemoval(entry))
    throw new Error('remote-owned workspace could not be verified');
  runGit(['worktree', 'remove', facts.executionRoot], root);
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
