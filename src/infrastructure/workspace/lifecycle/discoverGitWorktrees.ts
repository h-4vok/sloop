import { resolve } from 'node:path';
import type { BranchReconciliation } from '../BranchReconciliation.js';
import { runGit, readWorkspaceState } from './workspaceState.js';

/** Discover live Git worktrees for ownership and recovery decisions. */
export function discoverGitWorktrees(root: string) {
  const output = runGit(['worktree', 'list', '--porcelain'], root);
  const worktrees: { path: string; head: string; branch?: string }[] = [];
  let current: { path?: string; head?: string; branch?: string } = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      if (current.path && current.head)
        worktrees.push(current as { path: string; head: string; branch?: string });
      current = {};
    } else if (line.startsWith('worktree ')) current.path = resolve(line.slice(9));
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch '))
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  if (current.path && current.head)
    worktrees.push(current as { path: string; head: string; branch?: string });
  return worktrees;
}

/** Compare local checkout state with its remote branch and configured base. */
export function reconcileBranch(
  branch: string,
  remote = 'origin',
  baseBranch = 'main',
  root = process.cwd(),
): BranchReconciliation {
  try {
    const current = runGit(['symbolic-ref', '--short', 'HEAD'], root);
    if (current !== branch)
      return { aligned: false, diagnostic: `local checkout is on ${current}, expected ${branch}` };
    if (runGit(['status', '--porcelain=v1'], root))
      return { aligned: false, diagnostic: 'uncommitted local work remains' };
    const localSha = runGit(['rev-parse', 'HEAD^{commit}'], root);
    const remoteSha = runGit(['rev-parse', `${remote}/${branch}^{commit}`], root);
    const [behind, ahead] = runGit(
      ['rev-list', '--left-right', '--count', `${remote}/${branch}...HEAD`],
      root,
    )
      .split(/\s+/)
      .map(Number);
    if (behind !== 0 || ahead !== 0)
      return {
        aligned: false,
        diagnostic: `local branch diverges from ${remote}/${branch} (ahead=${ahead}, behind=${behind})`,
        localSha,
        remoteSha,
      };
    try {
      runGit(['merge-base', '--is-ancestor', `${remote}/${baseBranch}`, 'HEAD'], root);
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
    const detail = error instanceof Error ? error.message : String(error);
    return { aligned: false, diagnostic: `could not verify local/remote branch: ${detail}` };
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
