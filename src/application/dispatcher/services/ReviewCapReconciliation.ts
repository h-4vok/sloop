import type { State } from '../types/index.js';
import type { RemoteAuthority } from '../../../core/boundaries.js';
import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import { validateRunManifest } from '../../../remote-state.js';
import type { ReviewCapResumeContext } from '../types/ReviewCapResumeContext.js';
import { HitlResumeDirectiveService } from './HitlResumeDirectiveService.js';
const { activeRunForHitl } = HitlResumeDirectiveService;

function reconcileReviewCapResume(
  stored: State,
  remote: RemoteAuthority | undefined,
  processAlive: (pid: number) => boolean,
): ReviewCapResumeContext {
  let current = activeRunForHitl(stored, processAlive);
  const remoteSnapshot = remote?.snapshot(current.issue);
  const remoteManifest =
    remoteSnapshot?.manifest && validateRunManifest(remoteSnapshot.manifest, current.issue)
      ? remoteSnapshot.manifest
      : undefined;
  if (remoteSnapshot) {
    if (!remoteManifest) throw new Error('review-cap resume requires a valid remote run manifest');
    if (
      remoteSnapshot.pr !== current.pr ||
      remoteSnapshot.prState?.toUpperCase() !== 'OPEN' ||
      !remoteSnapshot.branch
    )
      throw new Error('review-cap resume could not reconcile the same open PR and head branch');
    current = {
      ...current,

      branch: remoteSnapshot.branch,

      headSha: remoteSnapshot.sha ?? current.headSha,

      reviewRound: Math.max(current.reviewRound ?? 1, remoteManifest.reviewRound ?? 1),
    };
    if (remoteManifest.pr !== current.pr)
      throw new Error('review-cap resume remote manifest belongs to a different PR');
  }

  return { current, remoteSnapshot, remoteManifest };
}

export const ReviewCapReconciliation = { reconcileReviewCapResume };
