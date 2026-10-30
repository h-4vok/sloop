import type { State, PullRequest } from '../../types/index.js';
import { randomUUID } from 'node:crypto';

function prepareRecovery(
  state: State,
  issue: number,
  pr: number,
  now: number,
  leaseMs: number,
  metadata?: Pick<PullRequest, 'baseRefOid' | 'headRefName' | 'headRefOid'>,
): State {
  const staleAt = now - leaseMs - 1;
  const recoveryDefaults = workerRecoveryDefaults(state, issue);

  return {
    ...state,

    issue,

    pr,

    branch: recoveryBranch(state, issue, metadata),

    mainBaseSha: metadata?.baseRefOid ?? state.mainBaseSha,

    headSha: metadata?.headRefOid ?? state.headSha,

    status: 'worker_running',

    workerRunId: randomUUID(),

    workerPid: -1,

    workerStartedAt: staleAt,

    workerHeartbeatAt: staleAt,

    ...recoveryDefaults,

    preparedRecovery: true,

    drainStatus: 'running',

    lastError: undefined,

    lastErrorVerbose: undefined,

    updatedAt: now,
  };
}

function recoveryBranch(
  state: State,
  issue: number,
  metadata?: Pick<PullRequest, 'headRefName'>,
): string {
  return metadata?.headRefName ?? state.branch ?? workerBranchName(issue);
}

function workerRecoveryDefaults(
  state: State,
  issue: number,
): Pick<State, 'workerRecoveryCount' | 'reviewRound' | 'completedIssues'> {
  return {
    workerRecoveryCount: state.workerRecoveryCount ?? 0,

    reviewRound: state.reviewRound ?? 1,

    completedIssues: (state.completedIssues ?? []).filter((number) => number !== issue),
  };
}

function workerBranchName(issue: number): string {
  if (!Number.isInteger(issue) || issue <= 0) throw new Error('issue number must be positive');
  return `codex/issue-${issue}`;
}

export const WorkerRecoveryState = { prepareRecovery, workerBranchName };
