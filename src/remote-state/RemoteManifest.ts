/** Current wire protocol version for durable GitHub run markers. */
export const REMOTE_PROTOCOL = 1;
export type RemoteSnapshot = Readonly<{
  protocol?: number;
  issue: number;
  issueState?: string;
  pr?: number;
  prState?: string;
  prMergedAt?: string;
  prBaseBranch?: string;
  labels?: readonly string[];
  markers?: readonly string[];
  comments?: readonly { marker?: string; body?: string; createdAt?: string; id?: number }[];
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
