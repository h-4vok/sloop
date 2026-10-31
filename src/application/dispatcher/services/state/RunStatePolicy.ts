/** Coordinates run state policy operations for dispatcher workflows. */
import type {
  Status,
  State,
  Config,
  Deps,
} from '../../../../application/dispatcher/types/index.js';
import { StateDiagnostics } from './StateDiagnostics.js';
const { normalizedError } = StateDiagnostics;

const skills = {
  claim: 'dispatcher',

  work: 'worker',

  recovery: 'dispatcher recovery',

  qa: 'sloop-qa',
} as const;

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

  return hasExpiredWorkerHeartbeat(s, cfg, d);
}

function hasExpiredWorkerHeartbeat(s: State, cfg: Config, d: Deps): boolean {
  const lastHeartbeat = s.workerHeartbeatAt ?? s.workerStartedAt;
  return Boolean(lastHeartbeat && d.now() - lastHeartbeat > (cfg.workerLeaseMs ?? 900000));
}

function recoveryContext(state: State): string {
  return [
    `status=${state.status ?? 'unknown'}`,
    `pr=${state.pr ?? 'none'}`,
    `branch=${state.branch ?? 'none'}`,
    `reviewRound=${state.reviewRound ?? 'unknown'}`,
  ].join(', ');
}

function recoveryCommand(state: State, issue: number): string {
  const pullRequest = state.pr ? ` --pr ${state.pr}` : '';

  return `then run "sloop --prepare-recovery ${issue}${pullRequest}" and retry "sloop".`;
}

function recoveryEligibilityError(state: State, issue: number): Error {
  const context = recoveryContext(state);
  const retryCommand = recoveryCommand(state, issue);
  return new Error(
    `Issue #${issue} cannot be recovered because it was not returned by the eligible-issues query. ` +
      `Sloop requires the issue to be open and labeled "Automation Ready". ` +
      `Persisted recovery context: ${context}. ` +
      `Verify with "gh issue view ${issue} --json state,labels"; add the label if needed, ` +
      retryCommand,
  );
}

function skillFor(status: Status | undefined): string {
  if (status === 'worker_running' || status === 'in_progress') return skills.work;
  if (status === 'worker_recovery_pending') return skills.recovery;
  if (status?.startsWith('qa_')) return skills.qa;
  return skills.claim;
}

function claimNewIssue(d: Deps, issue: number): void {
  const current = d.load();
  d.save({
    completedIssues: current.completedIssues ?? [],

    mainGreen: current.mainGreen,

    issue,

    status: 'claimed',

    reviewRound: 1,

    drainStatus: 'running',

    updatedAt: d.now(),
  });
  d.runLogger?.write('transition', { issue, from: current.status, to: 'claimed' });
  d.reportStatus?.(`[sloop] issue #${issue}: claimed`);
  d.comment(
    issue,
    `Sloop engineering v2: estado claimed. Skill activa: ${skillFor('claimed')}. QA precede la decisión humana; no se hace merge automático.`,
  );
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
  d.reportStatus?.(`[sloop] issue #${issue}: ${next}`);
  d.comment(
    issue,
    `Sloop engineering v2: estado ${next}. Skill activa: ${skillFor(next)}. QA precede la decisión humana; no se hace merge automático.`,
  );
}

export const RunStatePolicy = {
  isWorkerStatus,

  isActiveStatus,

  hasPersistedRecoveryContext,

  isStaleWorker,

  recoveryEligibilityError,

  skillFor,

  claimNewIssue,

  status,

  skills,
};
