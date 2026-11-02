/** Coordinates remote claim operations for dispatcher workflows. */
import type { Deps, Config } from '../../../../application/dispatcher/types/index.js';
import type { WorkflowProjection, RunManifest } from '../../../../remote-state.js';
import { result, type Result } from '../../../../core/Result.js';
import { CliFailure } from '../../types/CliFailure.js';
import { RemoteRunState } from './RemoteRunState.js';
const { remoteProjection, remoteOwner, remoteManifest, hydrateFromRemote } = RemoteRunState;

function assertRemoteLeaseAvailable(projection: WorkflowProjection): Result<void, CliFailure> {
  if (projection.openGates.includes('lease:owned'))
    return result.failure(new CliFailure(3, 'another dispatcher owns the remote run lease'));
  return result.success(undefined);
}

function publishReconciledManifest(
  d: Deps,
  issue: number,
  key: string,
  manifest: RunManifest,
): void {
  try {
    d.remote!.publish(issue, manifest);
  } catch (error) {
    if (!d.remote!.reconcile(issue, key)) throw error;
  }
}

function reuseExistingClaim(
  cfg: Config,
  d: Deps,
  issue: number,
  key: string,
  owner: string | undefined,
  existing: RunManifest,
  recoveryManifest: RunManifest | undefined,
  manifest: RunManifest,
): RunManifest {
  const refreshed = recoveryManifest
    ? manifest
    : remoteManifest(cfg, d, issue, existing.runId, key, existing.phase, owner, existing);
  publishReconciledManifest(d, issue, key, refreshed);
  hydrateFromRemote(d, refreshed);

  return refreshed;
}

function claimRemoteIssue(d: Deps, issue: number, key: string, manifest: RunManifest): void {
  try {
    d.remote!.claim(issue, key, manifest);
  } catch (error) {
    if (!d.remote!.reconcile(issue, key)) throw error;
  }
  if (!d.remote!.reconcile(issue, key))
    throw new Error(`remote claim marker did not reconcile for issue #${issue}`);
  hydrateFromRemote(d, manifest);
}

function ensureRemoteClaim(
  cfg: Config,
  d: Deps,
  issue: number,
  runId: string,
  key: string,
  recoveryManifest?: RunManifest,
): Result<RunManifest | undefined, Error> {
  if (!d.remote) return result.success(undefined);
  try {
    return result.success(resolveRemoteClaim(cfg, d, issue, runId, key, recoveryManifest));
  } catch (error) {
    return result.failure(error instanceof Error ? error : new Error(String(error)));
  }
}

function createClaimManifest(
  cfg: Config,
  d: Deps,
  issue: number,
  runId: string,
  key: string,
  owner: string,
  recoveryManifest: RunManifest | undefined,
): RunManifest {
  if (!recoveryManifest) return remoteManifest(cfg, d, issue, runId, key, 'claimed', owner);

  const phase = recoveryManifest.phase === 'blocked' ? 'working' : recoveryManifest.phase;
  return remoteManifest(cfg, d, issue, recoveryManifest.runId, key, phase, owner, recoveryManifest);
}

function resolveRemoteClaim(
  cfg: Config,
  d: Deps,
  issue: number,
  runId: string,
  key: string,
  recoveryManifest: RunManifest | undefined,
): RunManifest {
  const current = requireRemoteProjection(d, issue);
  const leaseResult = assertRemoteLeaseAvailable(current.projection);
  if (!leaseResult.ok) throw leaseResult.error;
  const owner = remoteOwner(d, issue);
  const manifest = createClaimManifest(cfg, d, issue, runId, key, owner, recoveryManifest);
  const reusedClaim = reuseMatchingClaim(
    cfg,
    d,
    issue,
    key,
    owner,
    current.projection.manifest,
    recoveryManifest,
    manifest,
  );
  if (reusedClaim) return reusedClaim;

  claimRemoteIssue(d, issue, key, manifest);
  return manifest;
}

function requireRemoteProjection(
  d: Deps,
  issue: number,
): NonNullable<ReturnType<typeof remoteProjection>> {
  const current = remoteProjection(d, issue);
  if (!current) throw new Error('remote authority is required for dispatcher lifecycle');

  return current;
}

function reuseMatchingClaim(
  cfg: Config,
  d: Deps,
  issue: number,
  key: string,
  owner: string,
  existing: RunManifest | undefined,
  recoveryManifest: RunManifest | undefined,
  manifest: RunManifest,
): RunManifest | undefined {
  if (!existing) return undefined;
  const hasExistingClaim = existing.artifacts.includes(key) || d.remote!.reconcile(issue, key);
  if (!hasExistingClaim) return undefined;

  return reuseExistingClaim(cfg, d, issue, key, owner, existing, recoveryManifest, manifest);
}

export const RemoteClaim = {
  assertRemoteLeaseAvailable,

  ensureRemoteClaim,
};
