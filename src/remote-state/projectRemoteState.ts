import { result, type Result } from '../core/Result.js';
import {
  REMOTE_PROTOCOL,
  type RemoteSnapshot,
  type RunManifest,
  type WorkflowProjection,
} from './RemoteManifest.js';
import { leaseIsActiveResult } from './runManifestMarker.js';
import { validateRunManifest } from './validateRunManifest.js';
import { collectRemoteStateGates } from './collectRemoteStateGates.js';

/** Project remote observations into an explicit workflow state or validation failure. */
export function projectRemoteState(snapshot: RemoteSnapshot): Result<WorkflowProjection, Error> {
  const validationError = snapshotValidationError(snapshot);
  if (validationError) return result.failure(validationError);
  const markers = collectMarkers(snapshot);
  const manifest = snapshot.manifest;
  if (!hasCurrentManifest(manifest, snapshot.issue, markers))
    return result.success({
      protocol: REMOTE_PROTOCOL,
      phase: 'idle',
      openGates: [],
      artifactKeys: markers,
    });
  return createProjection(snapshot, manifest as RunManifest, markers);
}

function snapshotValidationError(snapshot: RemoteSnapshot): Error | undefined {
  if (!Number.isInteger(snapshot.issue) || snapshot.issue <= 0)
    return new Error('invalid issue number');
  if (snapshot.protocol !== undefined && snapshot.protocol !== REMOTE_PROTOCOL)
    return new Error(`unsupported remote protocol: ${snapshot.protocol}`);
  return undefined;
}

function collectMarkers(snapshot: RemoteSnapshot): string[] {
  const commentMarkers = (snapshot.comments ?? []).map((comment) => comment.marker ?? '');
  return [
    ...new Set(
      [...(snapshot.markers ?? []), ...commentMarkers].filter((marker) =>
        marker.startsWith('sloop/v1/'),
      ),
    ),
  ].sort();
}

function hasCurrentManifest(
  manifest: Partial<RunManifest> | undefined,
  issue: number,
  markers: readonly string[],
): boolean {
  return Boolean(
    manifest &&
    validateRunManifest(manifest, issue) &&
    markers.includes(`sloop/v1/run/${manifest.runId}`),
  );
}

function createProjection(
  snapshot: RemoteSnapshot,
  manifest: RunManifest,
  markers: readonly string[],
): Result<WorkflowProjection, Error> {
  const leaseStateResult = createLeaseState(manifest, snapshot);
  if (!leaseStateResult.ok) return result.failure(leaseStateResult.error);

  const leaseState = leaseStateResult.value;
  const gates = collectRemoteStateGates(snapshot, manifest);
  const phase = projectedPhase(manifest, gates);
  appendLeaseOwnershipGate(gates, leaseState, snapshot.leaseOwner);

  return result.success({
    protocol: REMOTE_PROTOCOL,
    phase,
    openGates: gates,
    runId: manifest.runId,
    manifest,
    artifactKeys: [...new Set([...markers, ...manifest.artifacts])].sort(),
    ...optionalLease(leaseState),
  });
}

function projectedPhase(
  manifest: RunManifest,
  gates: readonly string[],
): WorkflowProjection['phase'] {
  if (manifest.phase === 'complete') return 'complete';
  if (gates.length) return 'review';
  return manifest.phase;
}

function appendLeaseOwnershipGate(
  gates: string[],
  lease: WorkflowProjection['lease'],
  leaseOwner: RemoteSnapshot['leaseOwner'],
): void {
  if (isLeaseOwnedByAnotherAgent(lease, leaseOwner)) gates.push('lease:owned');
}

function optionalLease(lease: WorkflowProjection['lease']) {
  return lease ? { lease } : {};
}

function createLeaseState(
  manifest: RunManifest,
  snapshot: RemoteSnapshot,
): Result<WorkflowProjection['lease'], Error> {
  if (!manifest.lease) return result.success(undefined);

  const leaseResult = leaseIsActiveResult(manifest.lease, snapshot.now ?? Date.now());
  if (!leaseResult.ok) return result.failure(leaseResult.error);

  return result.success({ ...manifest.lease, active: leaseResult.value });
}

function isLeaseOwnedByAnotherAgent(
  lease: WorkflowProjection['lease'],
  leaseOwner: RemoteSnapshot['leaseOwner'],
): boolean {
  return Boolean(lease?.active && leaseOwner && lease.owner !== leaseOwner);
}
