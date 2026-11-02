import type { Config, Deps } from '../types/index.js';
import type { Result } from '../../../core/Result.js';
import { CliFailure } from '../types/CliFailure.js';
import { applyRunRetention } from '../../../run-log.js';
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { isActiveStatus, isStaleWorker, hasPersistedRecoveryContext } = RunStatePolicy;
import { DispatcherPreflight } from './recovery/DispatcherPreflight.js';
const { validateDispatcherCompatibility, reconcilePersistedRun, validateRequiredAgentCommands } =
  DispatcherPreflight;
import { DispatcherLock } from './recovery/DispatcherLock.js';
const { acquireResult } = DispatcherLock;
import { DispatcherQueue } from './DispatcherQueue.js';
const {
  selectNextIssue,
  completeEmptyDispatch,
  dispatchSelectedIssue,
  findExistingRecoveryIssue,
  markDispatchRunning,
} = DispatcherQueue;

async function dispatch(cfg: Config, d: Deps): Promise<0 | 4> {
  requirePreflightSuccess(validateDispatcherCompatibility(cfg, d));
  requirePreflightSuccess(reconcilePersistedRun(d, d.load()));

  const state = d.load();
  const hasRemoteAuthority = Boolean(d.remote);
  const isRecovering = isRecoveringRun(state, cfg, d, hasRemoteAuthority);
  requireNoActiveRun(state, isRecovering, hasRemoteAuthority);

  const acquisitionResult = acquireResult(d, cfg.lockTtlMs ?? 900000);
  if (!acquisitionResult.ok) throw acquisitionResult.error;
  return runLockedDispatch(cfg, d, acquisitionResult.value, hasRemoteAuthority, isRecovering);
}

function isRecoveringRun(
  state: ReturnType<Deps['load']>,
  cfg: Config,
  d: Deps,
  hasRemoteAuthority: boolean,
): boolean {
  return (
    !hasRemoteAuthority &&
    (state.status === 'worker_recovery_pending' ||
      isStaleWorker(state, cfg, d) ||
      (state.status === 'blocked' && hasPersistedRecoveryContext(state)))
  );
}

function requireNoActiveRun(
  state: ReturnType<Deps['load']>,
  isRecovering: boolean,
  hasRemoteAuthority: boolean,
): void {
  if (isActiveStatus(state.status) && !isRecovering && !hasRemoteAuthority)
    throw new CliFailure(3, `active run exists for issue #${state.issue}`);
}

async function runLockedDispatch(
  cfg: Config,
  d: Deps,
  lockToken: string,
  hasRemoteAuthority: boolean,
  isRecovering: boolean,
): Promise<0 | 4> {
  try {
    requirePreflightSuccess(validateRequiredAgentCommands(cfg));
    applyRunRetention(d.root, cfg.loggingRetentionMs);
    const existingIssue = findExistingRecoveryIssue(d, hasRemoteAuthority, isRecovering);
    markDispatchRunning(d);
    const issue = selectNextIssue(d, cfg, existingIssue);
    if (!issue) return completeEmptyDispatch(d, existingIssue);

    return dispatchSelectedIssue(cfg, d, issue, isRecovering);
  } finally {
    d.release(lockToken);
  }
}

function requirePreflightSuccess(preflightResult: Result<void, Error>): void {
  if (!preflightResult.ok) throw preflightResult.error;
}

/** Owns one dispatcher pass: preflight, serialization, issue selection, and dispatch. */
export const Dispatcher = { dispatch };
