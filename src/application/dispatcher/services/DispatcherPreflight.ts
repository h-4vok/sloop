import type { Config, Deps, State } from '../types/index.js';
import { CliFailure } from '../types/CliFailure.js';
import { RunLogger, runDirectory } from '../../../run-log.js';
import { AgentRoles } from './AgentRoles.js';
const { roleCommand } = AgentRoles;
import { RunStatePolicy } from './RunStatePolicy.js';
const { isActiveStatus } = RunStatePolicy;

function validateDispatcherCompatibility(cfg: Config, d: Deps): void {
  if (d.remoteRequired && !d.remote)
    throw new Error('remote authority is required for production dispatcher lifecycle');
  if ('codexSandbox' in (cfg as Record<string, unknown>))
    throw new Error(
      'codexSandbox is no longer supported; configure --sandbox in each role command args',
    );
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'main')
    throw new Error(`Worker PR baseBranch must be main; found ${cfg.baseBranch}`);
}

function reconcilePersistedRun(d: Deps, initial: State): void {
  if (initial.issue && initial.workerRunId) {
    const logger = new RunLogger(runDirectory(d.root, initial.issue, initial.workerRunId));
    d.setRunLogger?.(logger);
  }
  if (!initial.issue || !isActiveStatus(initial.status) || !d.reconcileActiveRun) return;

  const result = d.reconcileActiveRun(initial);
  if (result.outcome === 'blocked') {
    const message = `Active run reconciliation blocked: ${result.reason}`;
    d.save({
      ...initial,
      status: 'blocked',
      lastError: message,
      lastErrorVerbose: message,
      updatedAt: d.now(),
    });
    d.runLogger?.write('reconciliation', result);
    throw new CliFailure(3, message);
  }
  if (result.outcome === 'terminal') {
    d.save({
      ...initial,
      status: 'done',
      completedIssues: [...new Set([...(initial.completedIssues ?? []), initial.issue])],
      drainStatus: 'running',
      lastError: `Reconciled completed run: ${result.reason}`,
      lastErrorVerbose: undefined,
      updatedAt: d.now(),
    });
    d.runLogger?.write('reconciliation', result);
  }
}

function validateRequiredAgentCommands(cfg: Config): void {
  if (!cfg.workerCommand || !cfg.qaCommand)
    throw new Error('workerCommand and qaCommand are required');
  roleCommand(cfg.workerCommand, 0, cfg);
  roleCommand(cfg.qaCommand, 0, cfg);
}

export const DispatcherPreflight = {
  validateDispatcherCompatibility,
  reconcilePersistedRun,
  validateRequiredAgentCommands,
};
