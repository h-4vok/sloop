import type { Deps, PullRequest } from '../../../../application/dispatcher/types/index.js';
import type { RunManifest } from '../../../../remote-state.js';

function createHydrationManifest(
  manifest: RunManifest,
  preparedPr: PullRequest | undefined,
): RunManifest {
  if (!preparedPr) return manifest;
  return {
    ...manifest,

    pr: preparedPr.number,

    branch: manifest.branch === 'pending' ? preparedPr.headRefName! : manifest.branch,
  };
}

function savePreparedRecoveryPr(d: Deps, preparedPr: PullRequest | undefined): void {
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

export const RemoteRecoveryHydration = {
  createHydrationManifest,

  savePreparedRecoveryPr,

  adoptRemotePullRequest,
};
