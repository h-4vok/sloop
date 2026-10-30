/** Coordinates worker branch operations for dispatcher workflows. */
import type { State, PullRequest } from '../../../application/dispatcher/types/index.js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CliFailure } from '../types/CliFailure.js';
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;

function prepareRecovery(
  state: State,
  issue: number,
  pr: number,
  now: number,
  leaseMs: number,
  metadata?: Pick<PullRequest, 'baseRefOid' | 'headRefName' | 'headRefOid'>,
): State {
  const staleAt = now - leaseMs - 1;
  return {
    ...state,

    issue,

    pr,

    branch: metadata?.headRefName ?? state.branch ?? workerBranchName(issue),

    mainBaseSha: metadata?.baseRefOid ?? state.mainBaseSha,

    headSha: metadata?.headRefOid ?? state.headSha,

    status: 'worker_running',

    workerRunId: randomUUID(),

    workerPid: -1,

    workerStartedAt: staleAt,

    workerHeartbeatAt: staleAt,

    workerRecoveryCount: state.workerRecoveryCount ?? 0,

    preparedRecovery: true,

    reviewRound: state.reviewRound ?? 1,

    completedIssues: (state.completedIssues ?? []).filter((number) => number !== issue),

    lastError: undefined,

    lastErrorVerbose: undefined,

    drainStatus: 'running',

    updatedAt: now,
  };
}

function workerBranchName(issue: number): string {
  if (!Number.isInteger(issue) || issue <= 0) throw new Error('issue number must be positive');
  return `codex/issue-${issue}`;
}

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
  let branch =
    branchPrefix === undefined
      ? workerBranchName(issue)
      : `${branchPrefix}${issue}-${randomUUID().slice(0, 4)}`;
  if (branchPrefix === undefined && hasLocalBranch(cwd, branch))
    throw new Error(`worker branch ${branch} already exists; refusing to overwrite it`);
  while (hasLocalBranch(cwd, branch))
    branch = `${branchPrefix ?? 'codex/issue-'}${issue}-${randomUUID().slice(0, 4)}`;

  return branch;
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
