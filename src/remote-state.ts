import { createHash } from 'node:crypto';

export const REMOTE_PROTOCOL = 1;
export type RemoteSnapshot = Readonly<{
  protocol?: number;
  issue: number;
  pr?: number;
  labels?: readonly string[];
  markers?: readonly string[];
  comments?: readonly { marker?: string; body?: string }[];
  checks?: readonly { name: string; status: string; conclusion?: string }[];
  reviews?: readonly { state: string }[];
  inlineThreads?: readonly { resolved: boolean }[];
  branch?: string;
  sha?: string;
  manifest?: Partial<RunManifest>;
  now?: number;
  leaseOwner?: string;
}>;
export type RunManifest = Readonly<{
  protocol: number;
  runId: string;
  issue: number;
  pr?: number;
  branch: string;
  baseSha: string;
  configFingerprint: string;
  phase: 'idle' | 'claimed' | 'working' | 'review' | 'blocked' | 'complete';
  lease?: { owner: string; expiresAt: string };
  reviewRound: number;
  contextCursor: string;
  artifacts: readonly string[];
}>;
export type WorkflowProjection = Readonly<{
  protocol: number;
  phase: 'idle' | 'claimed' | 'working' | 'review' | 'blocked' | 'complete';
  openGates: readonly string[];
  runId?: string;
  manifest?: RunManifest;
  artifactKeys: readonly string[];
  lease?: { owner: string; expiresAt: string; active: boolean };
}>;
const manifestPrefix = '<!-- sloop/v1/manifest ';
const manifestSuffix = ' -->';

/** Fixed, hidden protocol marker used as the durable workflow record. */
export function runManifestMarker(manifest: RunManifest): string {
  return `${manifestPrefix}${Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url')}${manifestSuffix}`;
}

/** Decode only the fixed manifest marker; free-form comments are never state. */
export function parseRunManifestMarker(body: string, issue: number): RunManifest | undefined {
  const match = body.match(/<!-- sloop\/v1\/manifest ([A-Za-z0-9_-]+) -->/);
  if (!match) return undefined;
  try {
    const manifest = JSON.parse(
      Buffer.from(match[1], 'base64url').toString('utf8'),
    ) as Partial<RunManifest>;
    return validateRunManifest(manifest, issue) ? manifest : undefined;
  } catch {
    return undefined;
  }
}
const sorted = (xs: readonly string[] = []) => [...new Set(xs)].sort();
export function artifactKey(kind: string, identity: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(identity).sort(([a], [b]) => a.localeCompare(b))),
  );
  return `sloop-v1/${kind}/${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}
export function leaseIsActive(lease: { expiresAt: string }, now = Date.now()): boolean {
  const expiry = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiry)) throw new Error('invalid lease expiry');
  return expiry > now;
}
export function reconcileArtifact(markers: readonly string[], key: string): boolean {
  return markers.some((marker) => marker === key || marker.startsWith(`${key}/`));
}
export function validateRunManifest(
  m: Partial<RunManifest> | undefined,
  issue: number,
): m is RunManifest {
  const phases = new Set(['idle', 'claimed', 'working', 'review', 'blocked', 'complete']);
  return Boolean(
    m &&
    m.protocol === REMOTE_PROTOCOL &&
    typeof m.runId === 'string' &&
    m.runId.length > 0 &&
    m.issue === issue &&
    typeof m.branch === 'string' &&
    m.branch.length > 0 &&
    typeof m.baseSha === 'string' &&
    /^[0-9a-f]{7,64}$/i.test(m.baseSha) &&
    typeof m.configFingerprint === 'string' &&
    m.configFingerprint.length > 0 &&
    typeof m.phase === 'string' &&
    phases.has(m.phase) &&
    Number.isSafeInteger(m.reviewRound) &&
    (m.reviewRound as number) >= 1 &&
    typeof m.contextCursor === 'string' &&
    Array.isArray(m.artifacts),
  );
}
export function projectRemoteState(s: RemoteSnapshot): WorkflowProjection {
  if (!Number.isInteger(s.issue) || s.issue <= 0) throw new Error('invalid issue number');
  if (s.protocol !== undefined && s.protocol !== REMOTE_PROTOCOL)
    throw new Error(`unsupported remote protocol: ${s.protocol}`);
  const markers = sorted(
    [...(s.markers ?? []), ...(s.comments ?? []).map((x) => x.marker ?? '')].filter((x) =>
      x.startsWith('sloop/v1/'),
    ),
  );
  const m = s.manifest;
  const phases = new Set(['idle', 'claimed', 'working', 'review', 'blocked', 'complete']);
  const validManifest = validateRunManifest(m, s.issue);
  const hasManifest = Boolean(validManifest && markers.includes(`sloop/v1/run/${m!.runId}`));
  if (!hasManifest)
    return { protocol: REMOTE_PROTOCOL, phase: 'idle', openGates: [], artifactKeys: markers };
  const checks = (s.checks ?? [])
    .filter((x) => x.conclusion !== 'success')
    .map((x) => `check:${x.name}`)
    .sort();
  const reviews = (s.reviews ?? []).filter(
    (x) => !['APPROVED', 'DISMISSED'].includes(x.state.toUpperCase()),
  ).length;
  const unresolved = (s.inlineThreads ?? []).filter((x) => !x.resolved).length;
  const baseSha = m!.baseSha ?? '';
  const gates = [
    ...checks,
    ...(reviews ? ['review'] : []),
    ...(unresolved ? [`inline:${unresolved}`] : []),
    ...[...(s.labels ?? [])]
      .sort()
      .filter((x) => /^(Automation Blocked|Blocked)$/i.test(x))
      .map((x) => `label:${x}`),
    ...(s.branch !== undefined && s.branch !== m!.branch ? ['branch:mismatch'] : []),
    ...(s.sha !== undefined && s.sha !== baseSha && s.sha !== baseSha.slice(0, 7)
      ? ['sha:mismatch']
      : []),
  ];
  const phase =
    m!.phase === 'complete'
      ? 'complete'
      : gates.length
        ? 'review'
        : (m!.phase as WorkflowProjection['phase']);
  const lease = m!.lease
    ? { ...m!.lease, active: leaseIsActive(m!.lease, s.now ?? Date.now()) }
    : undefined;
  if (lease && lease.active && s.leaseOwner && lease.owner !== s.leaseOwner)
    gates.push('lease:owned');
  return {
    protocol: REMOTE_PROTOCOL,
    phase,
    openGates: gates,
    runId: s.manifest!.runId,
    ...(validManifest ? { manifest: m as RunManifest } : {}),
    artifactKeys: sorted([...markers, ...(m!.artifacts ?? [])]),
    ...(lease ? { lease } : {}),
  };
}
