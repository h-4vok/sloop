/** Coordinates run state policy operations for dispatcher workflows. */
import type { Status, State, Config, Deps } from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';
import { StateDiagnostics } from './StateDiagnostics.js';
const { normalizedError } = StateDiagnostics;

const skills = {
  claim: 'dispatcher',

  work: 'worker',

  recovery: 'dispatcher recovery',

  qa: 'sloop-qa',
} as const;

function defaultProcessAlive(pid: number): boolean {
  if (!pid || pid < 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isWorkerStatus(status: Status | undefined): boolean {
  return status === 'worker_running' || status === 'in_progress';
}

function isActiveStatus(status: Status | undefined): boolean {
  return Boolean(
    status &&
    !['done', 'ready_for_human_merge', 'human_review_required', 'blocked', 'abandoned'].includes(
      status,
    ),
  );
}

function hasPersistedRecoveryContext(state: State): boolean {
  return Boolean(state.pr || state.branch);
}

function isStaleWorker(s: State, cfg: Config, d: Deps): boolean {
  if (!isWorkerStatus(s.status)) return false;
  if (typeof s.workerPid === 'number') return !d.processAlive(s.workerPid);
  const lastHeartbeat = s.workerHeartbeatAt ?? s.workerStartedAt;
  return Boolean(lastHeartbeat && d.now() - lastHeartbeat > (cfg.workerLeaseMs ?? 900000));
}

function recoveryEligibilityError(state: State, issue: number): Error {
  const context = [
    `status=${state.status ?? 'unknown'}`,
    `pr=${state.pr ?? 'none'}`,
    `branch=${state.branch ?? 'none'}`,
    `reviewRound=${state.reviewRound ?? 'unknown'}`,
  ].join(', ');
  return new Error(
    `Issue #${issue} cannot be recovered because it was not returned by the eligible-issues query. ` +
      `Sloop requires the issue to be open and labeled "Automation Ready". ` +
      `Persisted recovery context: ${context}. ` +
      `Verify with "gh issue view ${issue} --json state,labels"; add the label if needed, ` +
      `then run "sloop --prepare-recovery ${issue}${state.pr ? ` --pr ${state.pr}` : ''}" and retry "sloop".`,
  );
}

function skillFor(status: Status | undefined): string {
  if (status === 'worker_running' || status === 'in_progress') return skills.work;
  if (status === 'worker_recovery_pending') return skills.recovery;
  if (status?.startsWith('qa_')) return skills.qa;
  return skills.claim;
}

function status(d: Deps, issue: number, next: Status, extra: Partial<State> = {}): void {
  let current = d.load();
  const diagnostic =
    extra.lastError ??
    (['ci_failed', 'qa_changes_requested'].includes(next)
      ? (extra.lastCiFeedback ?? extra.lastQaFeedback)
      : undefined);
  const errors = diagnostic === undefined ? {} : normalizedError(next, diagnostic, current);
  d.save({ ...current, issue, status: next, updatedAt: d.now(), ...extra, ...errors });
  d.runLogger?.write('transition', { issue, from: current.status, to: next, state: extra });
  console.error(`[sloop] issue #${issue}: ${next}`);
  d.comment(
    issue,
    `Sloop engineering v2: estado ${next}. Skill activa: ${skillFor(next)}. QA precede la decisión humana; no se hace merge automático.`,
  );
}

export const RunStatePolicy = {
  defaultProcessAlive,

  isWorkerStatus,

  isActiveStatus,

  hasPersistedRecoveryContext,

  isStaleWorker,

  recoveryEligibilityError,

  skillFor,

  status,

  skills,
};
