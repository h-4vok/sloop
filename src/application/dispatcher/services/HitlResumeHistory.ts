import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import { parseRunManifestMarker } from '../../../remote-state.js';

function previousManifest(
  snapshot: RemoteSnapshot,
  issue: number,
  pr: number,
  branch: string,
  round: number,
  fallback: RunManifest | undefined,
): RunManifest | undefined {
  const history = (snapshot.comments ?? [])
    .map(({ body }) => (body ? parseRunManifestMarker(body, issue) : undefined))
    .filter(
      (candidate): candidate is RunManifest =>
        Boolean(candidate) &&
        candidate!.pr === pr &&
        candidate!.branch === branch &&
        candidate!.reviewRound <= round,
    )
    .sort((left, right) => right.reviewRound - left.reviewRound);

  return history[0] ?? fallback;
}

/** Finds the last compatible remote manifest for a human-directed resume. */
export const HitlResumeHistory = {
  previousManifest,
};
