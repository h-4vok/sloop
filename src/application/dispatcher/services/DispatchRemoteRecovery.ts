import type { Config, Deps, Issue } from '../types/index.js';
import type { RunManifest } from '../../../remote-state.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;
import { RemoteRunState } from './RemoteRunState.js';
const { remoteProjection, hydrateFromRemote, preparedRecoveryPullRequest } = RemoteRunState;
import { RemoteClaim } from './RemoteClaim.js';
const { assertRemoteLeaseAvailable } = RemoteClaim;
import { HitlResumeRestore } from './HitlResumeRestore.js';
const { restoreHitlResume } = HitlResumeRestore;

async function prepareRemoteRecovery(
  cfg: Config,
  d: Deps,
  issue: Issue,
  initiallyRecovering: boolean,
) {
  let recovery = initiallyRecovering;
  let remote = remoteProjection(d, issue.number);
  let manifest = remote?.projection.manifest;
  const restoredResume = remote
    ? restoreHitlResume(cfg, d, issue.number, remote.snapshot, manifest)
    : undefined;
  if (restoredResume) {
    manifest = restoredResume;
    remote = remoteProjection(d, issue.number) ?? remote;
    recovery = true;
  }
  if (manifest && manifest.phase !== 'complete') {
    if (!remote) throw new Error('remote projection is required for a remote manifest');
    assertRemoteLeaseAvailable(remote.projection);
    const preparedPr = manifest.pr
      ? undefined
      : await preparedRecoveryPullRequest(d, cfg, issue.number, manifest);
    const hydrationManifest = createHydrationManifest(manifest, preparedPr);
    recovery = manifest.branch !== 'pending' || Boolean(manifest.pr) || Boolean(preparedPr);
    hydrateFromRemote(d, hydrationManifest);
    savePreparedRecoveryPr(d, preparedPr);
    await adoptRemotePullRequest(d, manifest);
  }

  return { remote, manifest, recovery };
}

function createHydrationManifest(
  manifest: RunManifest,
  preparedPr: Awaited<ReturnType<typeof preparedRecoveryPullRequest>>,
) {
  if (!preparedPr) return manifest;
  return {
    ...manifest,

    pr: preparedPr.number,

    branch: manifest.branch === 'pending' ? preparedPr.headRefName! : manifest.branch,
  };
}

function savePreparedRecoveryPr(
  d: Deps,
  preparedPr: Awaited<ReturnType<typeof preparedRecoveryPullRequest>>,
): void {
  if (!preparedPr) return;
  d.save({
    ...d.load(),

    pr: preparedPr.number,

    branch: preparedPr.headRefName,

    headSha: preparedPr.headRefOid,

    mainBaseSha: preparedPr.baseRefOid ?? d.load().mainBaseSha,
  });
}

async function adoptRemotePullRequest(d: Deps, manifest: RunManifest): Promise<void> {
  if (!manifest.pr) return;
  const evidence = await d.pullRequest(manifest.pr);
  if (evidence.state?.toUpperCase() !== 'OPEN' || !evidence.headRefName)
    throw new Error(`PR #${manifest.pr} has no recoverable open head branch`);
  if (d.load().branch === evidence.headRefName) return;
  d.save({
    ...d.load(),

    pr: evidence.number,

    branch: evidence.headRefName,

    headSha: evidence.headRefOid,
  });
}

export const DispatchRemoteRecovery = { prepareRemoteRecovery };
