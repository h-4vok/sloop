/** Coordinates worker branch operations for dispatcher workflows. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CliFailure } from '../../types/CliFailure.js';
import { DispatcherRuntime } from '../DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { WorkerRecoveryState } from './WorkerRecoveryState.js';
const { prepareRecovery, workerBranchName } = WorkerRecoveryState;

function requireCleanCheckout(cwd: string): void {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
  if (dirty)
    throw new CliFailure(5, `working tree is dirty; refusing workspace preparation:\n${dirty}`);
}

function updateWorkerBase(cwd: string, remote: string, baseBranch: string): string {
  const baseRef = `${remote}/${baseBranch}`;
  try {
    execFileSync('git', ['checkout', baseBranch], { cwd, stdio: 'inherit' });
    execFileSync('git', ['pull', '--ff-only', remote, baseBranch], { cwd, stdio: 'inherit' });
    execFileSync('git', ['fetch', remote, baseBranch], { cwd, stdio: 'inherit' });
  } catch (error) {
    throw new CliFailure(5, error instanceof Error ? error.message : String(error));
  }
  const mainBaseSha = execFileSync('git', ['rev-parse', `${baseRef}^{commit}`], {
    cwd,

    encoding: 'utf8',
  }).trim();
  return mainBaseSha;
}

function hasLocalBranch(cwd: string, branch: string): boolean {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd,

      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function uniqueWorkerBranch(issue: number, cwd: string, branchPrefix?: string): string {
  if (branchPrefix === undefined) return requireUnusedDefaultBranch(issue, cwd);
  let branch = createPrefixedWorkerBranch(issue, branchPrefix);
  while (hasLocalBranch(cwd, branch)) branch = createPrefixedWorkerBranch(issue, branchPrefix);

  return branch;
}

function requireUnusedDefaultBranch(issue: number, cwd: string): string {
  const branch = workerBranchName(issue);
  if (hasLocalBranch(cwd, branch))
    throw new Error(`worker branch ${branch} already exists; refusing to overwrite it`);

  return branch;
}

function createPrefixedWorkerBranch(issue: number, branchPrefix: string): string {
  return `${branchPrefix}${issue}-${randomUUID().slice(0, 4)}`;
}

function createWorkerBranch(cwd: string, branch: string, mainBaseSha: string): void {
  execFileSync('git', ['checkout', '-b', branch, mainBaseSha], { cwd, stdio: 'inherit' });
}

function prepareWorkerBranch(
  issue: number,
  cwd = defaultRoot,
  remote = 'origin',
  baseBranch = 'main',
  branchPrefix?: string,
): { branch: string; mainBaseSha: string } {
  requireCleanCheckout(cwd);
  const mainBaseSha = updateWorkerBase(cwd, remote, baseBranch);
  const branch = uniqueWorkerBranch(issue, cwd, branchPrefix);
  createWorkerBranch(cwd, branch, mainBaseSha);

  return { branch, mainBaseSha };
}

function checkoutWorkerBranch(branch: string, cwd = defaultRoot): void {
  execFileSync('git', ['checkout', branch], { cwd, stdio: 'inherit' });
}

export const WorkerBranch = {
  prepareRecovery,

  workerBranchName,

  prepareWorkerBranch,

  checkoutWorkerBranch,
};
