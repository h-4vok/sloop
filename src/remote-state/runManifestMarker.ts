import { createHash } from 'node:crypto';
import { result, type Result } from '../core/Result.js';
import type { RunManifest } from './RemoteManifest.js';
import { validateRunManifest } from './validateRunManifest.js';

const manifestPrefix = '<!-- sloop/v1/manifest ';
const manifestSuffix = ' -->';

/** Encode a manifest in the stable hidden comment marker. */
export function runManifestMarker(manifest: RunManifest): string {
  return `${manifestPrefix}${Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url')}${manifestSuffix}`;
}

/** Decode and validate the exact manifest marker; malformed input is a Result failure. */
export function decodeRunManifestMarker(body: string, issue: number): Result<RunManifest, Error> {
  const match = body.match(/<!-- sloop\/v1\/manifest ([A-Za-z0-9_-]+) -->/);
  if (!match) return result.failure(new Error('manifest marker not found'));
  try {
    const manifest = JSON.parse(
      Buffer.from(match[1], 'base64url').toString('utf8'),
    ) as Partial<RunManifest>;
    return validateRunManifest(manifest, issue)
      ? result.success(manifest)
      : result.failure(new Error('invalid run manifest'));
  } catch (error) {
    return result.failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Keep the historical undefined-on-invalid decoder for callers. */
export function parseRunManifestMarker(body: string, issue: number): RunManifest | undefined {
  const decoded = decodeRunManifestMarker(body, issue);
  return decoded.ok ? decoded.value : undefined;
}

/** Build a deterministic protocol key from identity fields. */
export function artifactKey(kind: string, identity: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(identity).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `sloop-v1/${kind}/${digest}`;
}

/** Return whether an artifact marker represents this key or one of its children. */
export function reconcileArtifact(markers: readonly string[], key: string): boolean {
  return markers.some((marker) => marker === key || marker.startsWith(`${key}/`));
}

/** Parse lease expiry without throwing for expected malformed values. */
export function leaseIsActiveResult(
  lease: { expiresAt: string },
  now = Date.now(),
): Result<boolean, Error> {
  const expiry = Date.parse(lease.expiresAt);
  return Number.isFinite(expiry)
    ? result.success(expiry > now)
    : result.failure(new Error('invalid lease expiry'));
}

/** Compatibility wrapper that preserves the existing invalid-lease exception. */
export function leaseIsActive(lease: { expiresAt: string }, now = Date.now()): boolean {
  const active = leaseIsActiveResult(lease, now);
  if (!active.ok) throw active.error;
  return active.value;
}
