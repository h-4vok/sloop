import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';
import type { WorkspaceOptions } from '../WorkspaceOptions.js';
import { isInside, readWorkspaceState, runGit, writeWorkspaceState } from './workspaceState.js';
import type { RegisteredWorkspace } from './workspaceState.js';

function createBranchName(prefix: string, issue: number, root: string): string {
  for (;;) {
    const branchName = `${prefix}${issue}-${randomUUID().slice(0, 4)}`;
    try {
      runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], root);
    } catch {
      return branchName;
    }
  }
}

function createWorkspaceFacts(
  options: WorkspaceOptions,
  root: string,
  executionRoot: string,
  branch: string,
  baseSha: string,
  worktreeRoot?: string,
): WorkspaceFacts {
  return {
    workspaceRoot: root,
    executionRoot,
    ...(worktreeRoot ? { worktreeRoot } : {}),
    branch,
    baseSha,
    headSha: baseSha,
    ownership: { runId: options.runId, issue: options.issue, protocol: 'sloop-workspace-v1' },
  };
}

/** Prepare the existing checkout as a worker workspace after refusing dirty state. */
export function prepareCheckoutWorkspace(options: WorkspaceOptions): WorkspaceFacts {
  const root = resolve(options.repositoryRoot);
  const dirty = runGit(['status', '--porcelain=v1'], root);
  if (dirty) throw new Error(`working tree is dirty; refusing workspace preparation:\n${dirty}`);
  runGit(['checkout', options.baseBranch], root);
  runGit(['pull', '--ff-only', options.remote, options.baseBranch], root);
  runGit(['fetch', options.remote, options.baseBranch], root);
  const baseSha = runGit(['rev-parse', `${options.remote}/${options.baseBranch}^{commit}`], root);
  const branchName = createBranchName(options.branchPrefix, options.issue, root);
  runGit(['checkout', '-b', branchName, baseSha], root);
  return createWorkspaceFacts(options, root, root, branchName, baseSha);
}

/** Create and register an isolated worker worktree at the verified remote base. */
export function prepareWorktreeWorkspace(options: WorkspaceOptions): WorkspaceFacts {
  const root = resolve(options.repositoryRoot);
  const parent = resolve(root, options.worktreeRoot ?? '.sloop/worktrees');
  runGit(['fetch', options.remote, options.baseBranch], root);
  const baseSha = runGit(['rev-parse', `${options.remote}/${options.baseBranch}^{commit}`], root);
  const branchName = createBranchName(options.branchPrefix, options.issue, root);
  const executionRoot = resolve(parent, `${options.issue}-${options.runId.slice(0, 8)}`);
  if (!isInside(parent, executionRoot)) throw new Error('unsafe worktree target');
  if (existsSync(executionRoot))
    throw new Error(`worktree target already exists: ${executionRoot}`);
  mkdirSync(parent, { recursive: true });
  runGit(['worktree', 'add', '-b', branchName, executionRoot, baseSha], root);
  const facts = createWorkspaceFacts(options, root, executionRoot, branchName, baseSha, parent);
  const file = options.stateFile ?? resolve(root, '.sloop/state.json');
  const registration: RegisteredWorkspace = {
    ...facts,
    repositoryRoot: root,
    worktreeRoot: parent,
  };
  writeWorkspaceState(file, [...readWorkspaceState(file), registration]);
  return facts;
}
