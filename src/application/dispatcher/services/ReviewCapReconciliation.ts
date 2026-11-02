import type { State } from '../types/index.js';
import type { RemoteAuthority } from '../types/RemoteAuthority.js';
import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import { validateRunManifest } from '../../../remote-state.js';
import type { ReviewCapResumeContext } from '../types/ReviewCapResumeContext.js';
import { HitlResumeDirectiveService } from './hitl/HitlResumeDirectiveService.js';
const { activeRunForHitl } = HitlResumeDirectiveService;

type ActiveReviewCapState = State & Required<Pick<State, 'issue' | 'pr'>>;

function reconcileReviewCapResume(
  stored: State,
  remote: RemoteAuthority | undefined,
  processAlive: (pid: number) => boolean,
): ReviewCapResumeContext {
  let current = activeRunForHitl(stored, processAlive);
  const remoteSnapshot = remote?.snapshot(current.issue);
  const remoteManifest = resolveRemoteManifest(remoteSnapshot, current.issue);
  if (remoteSnapshot) {
    requireRemoteManifest(remoteManifest);
    requireReviewCapPullRequest(current, remoteSnapshot);
    current = updateReviewCapState(current, remoteSnapshot, remoteManifest);
    requireMatchingManifestPullRequest(current, remoteManifest);
  }

  return { current, remoteSnapshot, remoteManifest };
}

function resolveRemoteManifest(
  snapshot: RemoteSnapshot | undefined,
  issue: number,
): RunManifest | undefined {
  if (!snapshot?.manifest || !validateRunManifest(snapshot.manifest, issue)) return undefined;

  return snapshot.manifest;
}

function requireRemoteManifest(manifest: RunManifest | undefined): asserts manifest is RunManifest {
  if (!manifest) throw new Error('review-cap resume requires a valid remote run manifest');
}

function requireReviewCapPullRequest(
  current: State,
  snapshot: RemoteSnapshot,
): asserts snapshot is RemoteSnapshot & { branch: string } {
  if (snapshot.pr !== current.pr || snapshot.prState?.toUpperCase() !== 'OPEN' || !snapshot.branch)
    throw new Error('review-cap resume could not reconcile the same open PR and head branch');
}

function updateReviewCapState(
  current: ActiveReviewCapState,
  snapshot: RemoteSnapshot & { branch: string },
  manifest: RunManifest,
): ActiveReviewCapState {
  return {
    ...current,

    branch: snapshot.branch,

    headSha: snapshot.sha ?? current.headSha,

    reviewRound: Math.max(current.reviewRound ?? 1, manifest.reviewRound ?? 1),
  };
}

function requireMatchingManifestPullRequest(current: State, manifest: RunManifest): void {
  if (manifest.pr !== current.pr)
    throw new Error('review-cap resume remote manifest belongs to a different PR');
}

export const ReviewCapReconciliation = { reconcileReviewCapResume };
