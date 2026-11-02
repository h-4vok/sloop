import type { RemoteSnapshot, RunManifest } from './RemoteManifest.js';

/** Collects deterministic review gates from current GitHub observations. */
export function collectRemoteStateGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
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

function countUnresolved(snapshot: RemoteSnapshot): string[] {
  const count = (snapshot.inlineThreads ?? []).filter((thread) => !thread.resolved).length;
  return count ? [`threads:${count}`] : [];
}

function blockedLabels(snapshot: RemoteSnapshot): string[] {
  return [...(snapshot.labels ?? [])]
    .sort()
    .filter((label) => /^(Automation Blocked|Blocked)$/i.test(label))
    .map((label) => `label:${label}`);
}

function branchGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
  return snapshot.branch !== undefined && snapshot.branch !== manifest.branch
    ? ['branch:mismatch']
    : [];
}

function shaGates(snapshot: RemoteSnapshot, manifest: RunManifest): string[] {
  return hasShaMismatch(snapshot.sha, manifest.baseSha) ? ['sha:mismatch'] : [];
}

function hasShaMismatch(sha: string | undefined, baseSha: string): boolean {
  return sha !== undefined && sha !== baseSha && sha !== baseSha.slice(0, 7);
}
