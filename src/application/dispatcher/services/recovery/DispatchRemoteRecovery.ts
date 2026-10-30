import type {
  Config,
  Deps,
  Issue,
  PullRequest,
} from '../../../../application/dispatcher/types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
import { result, type Result } from '../../../../core/Result.js';
import { RemoteRunState } from './RemoteRunState.js';
const { remoteProjection, hydrateFromRemote } = RemoteRunState;
import { PreparedRecoveryPullRequest } from './PreparedRecoveryPullRequest.js';
const { fetchPreparedRecoveryPullRequest } = PreparedRecoveryPullRequest;
import { RemoteClaim } from './RemoteClaim.js';
const { assertRemoteLeaseAvailable } = RemoteClaim;
import { HitlResumeRestore } from '../HitlResumeRestore.js';
const { restoreHitlResume } = HitlResumeRestore;
import { RemoteRecoveryHydration } from './RemoteRecoveryHydration.js';
const { createHydrationManifest, savePreparedRecoveryPr, adoptRemotePullRequest } =
  RemoteRecoveryHydration;

type RemoteRecoveryState = Readonly<{
  remote: ReturnType<typeof remoteProjection>;
  manifest: RunManifest | undefined;
  recovery: boolean;
}>;

async function prepareRemoteRecovery(
  cfg: Config,
  d: Deps,
  issue: Issue,
  initiallyRecovering: boolean,
): Promise<Result<RemoteRecoveryState, Error>> {
  try {
    const recovery = await prepareRemoteRecoveryState(cfg, d, issue, initiallyRecovering);
    return result.success(recovery);
  } catch (error) {
    return result.failure(error instanceof Error ? error : new Error(String(error)));
  }
}

async function prepareRemoteRecoveryState(
  cfg: Config,
  d: Deps,
  issue: Issue,
  initiallyRecovering: boolean,
): Promise<RemoteRecoveryState> {
  const context = restoreRemoteRecoveryContext(cfg, d, issue, initiallyRecovering);
  if (!hasIncompleteManifest(context.manifest)) return context;

  return hydrateRemoteRecovery(cfg, d, issue, context);
}

function restoreRemoteRecoveryContext(
  cfg: Config,
  d: Deps,
  issue: Issue,
  initiallyRecovering: boolean,
): RemoteRecoveryState {
  let remote = remoteProjection(d, issue.number);
  let manifest = remote?.projection.manifest;
  let recovery = initiallyRecovering;
  const restoredManifest = remote
    ? restoreHitlResume(cfg, d, issue.number, remote.snapshot, manifest)
    : undefined;
  if (restoredManifest) {
    manifest = restoredManifest;
    remote = remoteProjection(d, issue.number) ?? remote;
    recovery = true;
  }

  return { remote, manifest, recovery };
}

function hasIncompleteManifest(manifest: RunManifest | undefined): manifest is RunManifest {
  return Boolean(manifest && manifest.phase !== 'complete');
}

async function hydrateRemoteRecovery(
  cfg: Config,
  d: Deps,
  issue: Issue,
  context: RemoteRecoveryState,
): Promise<RemoteRecoveryState> {
  const { remote, manifest } = context;
  if (!remote || !manifest) throw new Error('remote projection is required for a remote manifest');
  const leaseResult = assertRemoteLeaseAvailable(remote.projection);
  if (!leaseResult.ok) throw leaseResult.error;
  const preparedPr = await fetchPreparedPr(d, cfg, issue.number, manifest);
  const hydrationManifest = createHydrationManifest(manifest, preparedPr);
  const recovery = manifest.branch !== 'pending' || Boolean(manifest.pr) || Boolean(preparedPr);
  hydrateFromRemote(d, hydrationManifest);
  savePreparedRecoveryPr(d, preparedPr);
  await adoptRemotePullRequest(d, manifest);

  return { remote, manifest, recovery };
}

async function fetchPreparedPr(
  d: Deps,
  cfg: Config,
  issue: number,
  manifest: RunManifest,
): Promise<PullRequest | undefined> {
  if (manifest.pr) return undefined;
  const preparedPrResult = await fetchPreparedRecoveryPullRequest(d, cfg, issue, manifest);
  if (!preparedPrResult.ok) throw preparedPrResult.error;

  return preparedPrResult.value;
}

export const DispatchRemoteRecovery = { prepareRemoteRecovery };
