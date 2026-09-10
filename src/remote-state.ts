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
}>;
export type RunManifest = Readonly<{
  protocol: number;
  runId: string;
  issue: number;
  pr?: number;
  branch: string;
  baseSha: string;
  configFingerprint: string;
  phase: string;
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
  artifactKeys: readonly string[];
}>;
const sorted = (xs: readonly string[] = []) => [...new Set(xs)].sort();
export function artifactKey(kind: string, identity: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(identity).sort(([a], [b]) => a.localeCompare(b))),
  );
  return `sloop-v1/${kind}/${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}
export function projectRemoteState(s: RemoteSnapshot): WorkflowProjection {
  if (s.protocol !== undefined && s.protocol !== REMOTE_PROTOCOL)
    throw new Error(`unsupported remote protocol: ${s.protocol}`);
  const markers = sorted(
    [...(s.markers ?? []), ...(s.comments ?? []).map((x) => x.marker ?? '')].filter((x) =>
      x.startsWith('sloop/v1/'),
    ),
  );
  const hasManifest =
    Boolean(s.manifest?.runId) && markers.includes(`sloop/v1/run/${s.manifest!.runId}`);
  if (!hasManifest)
    return { protocol: REMOTE_PROTOCOL, phase: 'idle', openGates: [], artifactKeys: markers };
  const checks = (s.checks ?? [])
    .filter((x) => x.conclusion !== 'success')
    .map((x) => `check:${x.name}`)
    .sort();
  const reviews = (s.reviews ?? []).filter((x) => !['APPROVED'].includes(x.state)).length;
  const unresolved = (s.inlineThreads ?? []).filter((x) => !x.resolved).length;
  const gates = [
    ...checks,
    ...(reviews ? ['review'] : []),
    ...(unresolved ? [`inline:${unresolved}`] : []),
  ];
  const phase =
    s.manifest!.phase === 'complete'
      ? 'complete'
      : gates.length
        ? 'review'
        : (s.manifest!.phase as WorkflowProjection['phase']) || 'working';
  return {
    protocol: REMOTE_PROTOCOL,
    phase,
    openGates: gates,
    runId: s.manifest!.runId,
    artifactKeys: markers,
  };
}
