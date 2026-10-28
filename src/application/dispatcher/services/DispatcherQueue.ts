import type { Config, Deps, Issue } from '../types/index.js';
import { CliFailure } from '../types/CliFailure.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const {
  isActiveStatus,
  isWorkerStatus,
  hasPersistedRecoveryContext,
  recoveryEligibilityError,
  status,
} = RunStatePolicy;
import { IssueSelection } from './IssueSelection.js';
const { selectIssues } = IssueSelection;
import { DispatchIssueRunner } from './DispatchIssueRunner.js';
const { runIssueUnderMutex } = DispatchIssueRunner;

function selectNextIssue(
  d: Deps,
  cfg: Config,
  existingIssue: number | undefined,
): Issue | undefined {
  const ordered = selectIssues(d.eligible(), cfg.priorityLabels);
  if (existingIssue) return ordered.find((issue) => issue.number === existingIssue);
  const completedIssues = new Set(d.load().completedIssues ?? []);
  return ordered.find((issue) => !completedIssues.has(issue.number));
}

function completeEmptyDispatch(d: Deps, existingIssue: number | undefined): 0 {
  if (existingIssue) throw recoveryEligibilityError(d.load(), existingIssue);
  const state = d.load();
  d.save({
    completedIssues: state.completedIssues ?? [],

    mainGreen: state.mainGreen,

    status: 'done',

    drainStatus: 'done',

    updatedAt: d.now(),
  });

  return 0;
}

async function dispatchSelectedIssue(
  cfg: Config,
  d: Deps,
  issue: Issue,
  recovery: boolean,
): Promise<0 | 4> {
  try {
    await runIssueUnderMutex(cfg, d, issue, recovery);
    return 0;
  } catch (error) {
    return handleIssueFailure(d, issue, error);
  } finally {
    d.setRunLogger?.(undefined);
  }
}

function handleIssueFailure(d: Deps, issue: Issue, error: unknown): 4 {
  if (error instanceof CliFailure) throw error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sloop] issue #${issue.number} bloqueada: ${message}`);
  const current = d.load();
  const shouldPreserveRecovery =
    isWorkerStatus(current.status) ||
    current.status === 'worker_recovery_pending' ||
    hasPersistedRecoveryContext(current);
  status(d, issue.number, shouldPreserveRecovery ? 'worker_recovery_pending' : 'blocked', {
    lastError: message,

    pr: current.pr,
  });

  return 4;
}

function findExistingRecoveryIssue(
  d: Deps,
  remoteAuthority: boolean,
  recovery: boolean,
): number | undefined {
  const state = d.load();
  return !remoteAuthority && (recovery || isActiveStatus(state.status)) ? state.issue : undefined;
}

function markDispatchRunning(d: Deps): void {
  d.save({ ...d.load(), drainStatus: 'running' });
}

export const DispatcherQueue = {
  selectNextIssue,

  completeEmptyDispatch,

  dispatchSelectedIssue,

  findExistingRecoveryIssue,

  markDispatchRunning,
};
