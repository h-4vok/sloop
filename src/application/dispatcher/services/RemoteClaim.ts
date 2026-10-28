/** Coordinates remote claim operations for dispatcher workflows. */
import type { Deps, Config } from '../../../application/dispatcher/types/index.js';
import type { WorkflowProjection, RunManifest } from '../../../remote-state.js';
import { CliFailure } from '../types/CliFailure.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status, skillFor } = RunStatePolicy;
import { RemoteRunState } from './RemoteRunState.js';
const { remoteProjection, remoteOwner, remoteManifest, hydrateFromRemote } = RemoteRunState;

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
  console.error(`[sloop] issue #${issue}: claimed`);
  d.comment(
    issue,
    `Sloop engineering v2: estado claimed. Skill activa: ${skillFor('claimed')}. QA precede la decisión humana; no se hace merge automático.`,
  );
}

function assertRemoteLeaseAvailable(projection: WorkflowProjection): void {
  if (projection.openGates.includes('lease:owned'))
    throw new CliFailure(3, 'another dispatcher owns the remote run lease');
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
): RunManifest | undefined {
  if (!d.remote) return undefined;
  const current = remoteProjection(d, issue);
  if (!current) throw new Error('remote authority is required for dispatcher lifecycle');
  assertRemoteLeaseAvailable(current.projection);
  const owner = remoteOwner(d, issue);
  const recoveryPhase = recoveryManifest?.phase === 'blocked' ? 'working' : recoveryManifest?.phase;
  const manifest = recoveryManifest
    ? remoteManifest(
        cfg,
        d,
        issue,
        recoveryManifest.runId,
        key,
        recoveryPhase!,
        owner,
        recoveryManifest,
      )
    : remoteManifest(cfg, d, issue, runId, key, 'claimed', owner);
  if (current.projection.manifest) {
    const existing = current.projection.manifest;
    const existingKey = existing.artifacts.includes(key) || d.remote.reconcile(issue, key);
    if (existingKey)
      return reuseExistingClaim(cfg, d, issue, key, owner, existing, recoveryManifest, manifest);
  }

  claimRemoteIssue(d, issue, key, manifest);
  return manifest;
}

export const RemoteClaim = {
  claimNewIssue,
  assertRemoteLeaseAvailable,
  ensureRemoteClaim,
};
