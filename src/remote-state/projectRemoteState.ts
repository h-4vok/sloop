import { result, type Result } from '../core/Result.js';
import {
  REMOTE_PROTOCOL,
  type RemoteSnapshot,
  type RunManifest,
  type WorkflowProjection,
} from './RemoteManifest.js';
import { leaseIsActiveResult } from './runManifestMarker.js';
import { validateRunManifest } from './validateRunManifest.js';

/** Project remote observations into an explicit workflow state or validation failure. */
export function projectRemoteState(snapshot: RemoteSnapshot): Result<WorkflowProjection, Error> {
  if (!Number.isInteger(snapshot.issue) || snapshot.issue <= 0)
    return result.failure(new Error('invalid issue number'));
  if (snapshot.protocol !== undefined && snapshot.protocol !== REMOTE_PROTOCOL)
    return result.failure(new Error(`unsupported remote protocol: ${snapshot.protocol}`));
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
  const lease = manifest.lease
    ? leaseIsActiveResult(manifest.lease, snapshot.now ?? Date.now())
    : undefined;
  if (lease && !lease.ok) return result.failure(lease.error);
  const leaseState =
    manifest.lease && lease?.ok ? { ...manifest.lease, active: lease.value } : undefined;
  const gates = collectGates(snapshot, manifest);
  const phase =
    manifest.phase === 'complete' ? 'complete' : gates.length ? 'review' : manifest.phase;
  if (leaseState?.active && snapshot.leaseOwner && leaseState.owner !== snapshot.leaseOwner)
    gates.push('lease:owned');
  return result.success({
    protocol: REMOTE_PROTOCOL,
    phase,
    openGates: gates,
    runId: manifest.runId,
    manifest,
    artifactKeys: [...new Set([...markers, ...manifest.artifacts])].sort(),
    ...(leaseState ? { lease: leaseState } : {}),
  });
}

function collectGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
  return [
    ...checkGates(snapshot),
    ...reviewGates(snapshot),
    ...countUnresolved(snapshot),
    ...blockedLabels(snapshot),
    ...branchGates(snapshot, manifest),
    ...shaGates(snapshot, manifest),
  ];
}

function checkGates(snapshot: RemoteSnapshot): string[] {
  return (snapshot.checks ?? [])
    .filter((check) => check.conclusion !== 'success')
    .map((check) => `check:${check.name}`)
    .sort();
}

function reviewGates(snapshot: RemoteSnapshot): string[] {
  const hasOpenReview = (snapshot.reviews ?? []).some(
    (review) => !['APPROVED', 'DISMISSED'].includes(review.state.toUpperCase()),
  );
  return hasOpenReview ? ['review'] : [];
}

function branchGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
  return snapshot.branch !== undefined && snapshot.branch !== manifest.branch
    ? ['branch:mismatch']
    : [];
}

function shaGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
  return hasShaMismatch(snapshot.sha, manifest.baseSha) ? ['sha:mismatch'] : [];
}

function countUnresolved(snapshot: RemoteSnapshot): string[] {
  const count = (snapshot.inlineThreads ?? []).filter((thread) => !thread.resolved).length;
  return count ? [`inline:${count}`] : [];
}

function blockedLabels(snapshot: RemoteSnapshot): string[] {
  return [...(snapshot.labels ?? [])]
    .sort()
    .filter((label) => /^(Automation Blocked|Blocked)$/i.test(label))
    .map((label) => `label:${label}`);
}

function hasShaMismatch(sha: string | undefined, baseSha: string): boolean {
  return sha !== undefined && sha !== baseSha && sha !== baseSha.slice(0, 7);
}
