import { REMOTE_PROTOCOL, type RunManifest } from './RemoteManifest.js';

/** Confirm a manifest matches the required wire contract and expected issue. */
export function validateRunManifest(
  manifest: Partial<RunManifest> | undefined,
  issue: number,
): manifest is RunManifest {
  return Boolean(
    manifest &&
    manifest.protocol === REMOTE_PROTOCOL &&
    isNonEmptyString(manifest.runId) &&
    manifest.issue === issue &&
    isNonEmptyString(manifest.branch) &&
    typeof manifest.baseSha === 'string' &&
    /^[0-9a-f]{7,64}$/i.test(manifest.baseSha) &&
    isNonEmptyString(manifest.configFingerprint) &&
    isPhase(manifest.phase) &&
    Number.isSafeInteger(manifest.reviewRound) &&
    (manifest.reviewRound as number) >= 1 &&
    typeof manifest.contextCursor === 'string' &&
    Array.isArray(manifest.artifacts),
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPhase(value: unknown): value is RunManifest['phase'] {
  return ['idle', 'claimed', 'working', 'review', 'blocked', 'complete'].includes(String(value));
}
