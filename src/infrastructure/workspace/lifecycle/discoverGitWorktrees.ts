import { resolve } from 'node:path';
import type { BranchReconciliation } from '../BranchReconciliation.js';
import { runGit, readWorkspaceState } from './workspaceState.js';

/** Discover live Git worktrees for ownership and recovery decisions. */
export function discoverGitWorktrees(root: string) {
  const output = runGit(['worktree', 'list', '--porcelain'], root);
  const worktrees: { path: string; head: string; branch?: string }[] = [];
  let current: { path?: string; head?: string; branch?: string } = {};
  for (const line of output.split(/\r?\n/)) {
    if (line === '') {
      appendCurrentWorktree(worktrees, current);
      current = {};
      continue;
    }
    updateWorktreeMetadata(current, line);
  }
  appendCurrentWorktree(worktrees, current);
  return worktrees;
}

function updateWorktreeMetadata(
  current: { path?: string; head?: string; branch?: string },
  line: string,
): void {
  if (setWorktreePath(current, line)) return;
  if (setWorktreeHead(current, line)) return;
  setWorktreeBranch(current, line);
}

function setWorktreePath(current: { path?: string }, line: string): boolean {
  if (!line.startsWith('worktree ')) return false;
  current.path = resolve(line.slice(9));
  return true;
}

function setWorktreeHead(current: { head?: string }, line: string): boolean {
  if (!line.startsWith('HEAD ')) return false;
  current.head = line.slice(5);
  return true;
}

function setWorktreeBranch(current: { branch?: string }, line: string): void {
  if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
}

function appendCurrentWorktree(
  worktrees: { path: string; head: string; branch?: string }[],
  current: { path?: string; head?: string; branch?: string },
): void {
  if (current.path && current.head)
    worktrees.push(current as { path: string; head: string; branch?: string });
}

/** Compare local checkout state with its remote branch and configured base. */
export function reconcileBranch(
  branch: string,
  remote = 'origin',
  baseBranch = 'main',
  root = process.cwd(),
): BranchReconciliation {
  try {
    return inspectBranch(root, branch, remote, baseBranch);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { aligned: false, diagnostic: `could not verify local/remote branch: ${detail}` };
  }
}

function inspectBranch(
  root: string,
  branch: string,
  remote: string,
  baseBranch: string,
): BranchReconciliation {
  const current = runGit(['symbolic-ref', '--short', 'HEAD'], root);
  if (current !== branch)
    return { aligned: false, diagnostic: `local checkout is on ${current}, expected ${branch}` };
  if (runGit(['status', '--porcelain=v1'], root))
    return { aligned: false, diagnostic: 'uncommitted local work remains' };
  const facts = readBranchFacts(root, branch, remote);
  if (branchHasDiverged(facts))
    return {
      aligned: false,
      diagnostic: `local branch diverges from ${remote}/${branch} (ahead=${facts.ahead}, behind=${facts.behind})`,
      localSha: facts.localSha,
      remoteSha: facts.remoteSha,
    };
  if (!isBasedOnBaseBranch(root, remote, baseBranch))
    return {
      aligned: false,
      diagnostic: `branch is not based on ${remote}/${baseBranch}`,
      localSha: facts.localSha,
      remoteSha: facts.remoteSha,
    };
  return {
    aligned: true,
    diagnostic: 'branch is clean and aligned',
    localSha: facts.localSha,
    remoteSha: facts.remoteSha,
  };
}

function branchHasDiverged(facts: ReturnType<typeof readBranchFacts>): boolean {
  return facts.behind !== 0 || facts.ahead !== 0;
}

function readBranchFacts(root: string, branch: string, remote: string) {
  const localSha = runGit(['rev-parse', 'HEAD^{commit}'], root);
  const remoteSha = runGit(['rev-parse', `${remote}/${branch}^{commit}`], root);
  const [behind, ahead] = runGit(
    ['rev-list', '--left-right', '--count', `${remote}/${branch}...HEAD`],
    root,
  )
    .split(/\s+/)
    .map(Number);
  return { localSha, remoteSha, behind, ahead };
}

function isBasedOnBaseBranch(root: string, remote: string, baseBranch: string): boolean {
  try {
    runGit(['merge-base', '--is-ancestor', `${remote}/${baseBranch}`, 'HEAD'], root);
    return true;
  } catch {
    return false;
  }
}

/** List registrations belonging to one repository using the stable CLI shape. */
export function listOwnedWorkspaces(
  repositoryRoot: string,
  stateFile = resolve(repositoryRoot, '.sloop/state.json'),
) {
  return readWorkspaceState(stateFile)
    .filter((entry) => entry.repositoryRoot === resolve(repositoryRoot))
    .map((entry) => ({
      path: entry.executionRoot,
      branch: entry.branch,
      issue: entry.ownership.issue,
      pr: entry.pr ?? '—',
    }));
}
