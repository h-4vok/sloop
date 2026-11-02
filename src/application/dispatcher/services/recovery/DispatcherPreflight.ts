import type { Config, Deps, State } from '../../../../application/dispatcher/types/index.js';
import { result, type Result } from '../../../../core/Result.js';
import { CliFailure } from '../../types/CliFailure.js';
import { AgentRoles } from '../AgentRoles.js';
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { roleCommand } = AgentRoles;
const { isActiveStatus } = RunStatePolicy;
type ActiveRunReconciliation = ReturnType<NonNullable<Deps['reconcileActiveRun']>>;

function validateDispatcherCompatibility(cfg: Config, d: Deps): Result<void, Error> {
  if (d.remoteRequired && !d.remote)
    return result.failure(
      new Error('remote authority is required for production dispatcher lifecycle'),
    );
  if ('codexSandbox' in (cfg as Record<string, unknown>))
    return result.failure(
      new Error(
        'codexSandbox is no longer supported; configure --sandbox in each role command args',
      ),
    );
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'main')
    return result.failure(new Error(`Worker PR baseBranch must be main; found ${cfg.baseBranch}`));

  return result.success(undefined);
}

function reconcilePersistedRun(d: Deps, initial: State): Result<void, Error> {
  attachPersistedRunLogger(d, initial);
  if (!shouldReconcileActiveRun(d, initial)) return result.success(undefined);
  try {
    return applyActiveRunReconciliation(d, initial);
  } catch (error) {
    return result.failure(toError(error));
  }
}

function attachPersistedRunLogger(d: Deps, state: State): void {
  if (!state.issue || !state.workerRunId || !d.createRunLogger) return;
  d.setRunLogger?.(d.createRunLogger(state.issue, state.workerRunId));
}

function shouldReconcileActiveRun(d: Deps, state: State): boolean {
  return Boolean(state.issue && isActiveStatus(state.status) && d.reconcileActiveRun);
}

function applyActiveRunReconciliation(d: Deps, state: State): Result<void, CliFailure> {
  const reconciliation = d.reconcileActiveRun!(state);
  if (reconciliation.outcome === 'blocked') return blockUnrecoverableRun(d, state, reconciliation);
  if (reconciliation.outcome === 'terminal') completeReconciledRun(d, state, reconciliation);

  return result.success(undefined);
}

function blockUnrecoverableRun(
  d: Deps,
  state: State,
  reconciliation: ActiveRunReconciliation,
): Result<void, CliFailure> {
  const message = `Active run reconciliation blocked: ${reconciliation.reason}`;
  d.save({
    ...state,

    status: 'blocked',

    lastError: message,

    lastErrorVerbose: message,

    updatedAt: d.now(),
  });
  d.runLogger?.write('reconciliation', reconciliation);

  return result.failure(new CliFailure(3, message));
}

function completeReconciledRun(
  d: Deps,
  state: State,
  reconciliation: ActiveRunReconciliation,
): void {
  d.save({
    ...state,

    status: 'done',

    completedIssues: [...new Set([...(state.completedIssues ?? []), state.issue!])],

    drainStatus: 'running',

    lastError: `Reconciled completed run: ${reconciliation.reason}`,

    lastErrorVerbose: undefined,

    updatedAt: d.now(),
  });
  d.runLogger?.write('reconciliation', reconciliation);
}

function validateRequiredAgentCommands(cfg: Config): Result<void, Error> {
  if (!cfg.workerCommand || !cfg.qaCommand)
    return result.failure(new Error('workerCommand and qaCommand are required'));
  try {
    roleCommand(cfg.workerCommand, 0, cfg);
    roleCommand(cfg.qaCommand, 0, cfg);
    return result.success(undefined);
  } catch (error) {
    return result.failure(toError(error));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const DispatcherPreflight = {
  validateDispatcherCompatibility,

  reconcilePersistedRun,

  validateRequiredAgentCommands,
};
