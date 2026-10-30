import type { Config, Deps, Issue, State } from '../../types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
import { artifactKey } from '../../../../remote-state.js';
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { RemoteClaim } from '../recovery/RemoteClaim.js';
const { ensureRemoteClaim } = RemoteClaim;
import { RemoteManifestPublisher } from '../RemoteManifestPublisher.js';
const { publishRemoteManifest } = RemoteManifestPublisher;
import { FreshWorkerWorkspace } from './FreshWorkerWorkspace.js';
const { prepareFreshWorker } = FreshWorkerWorkspace;

async function prepareRecoveryWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  claimed: RunManifest | undefined,
  manifest: RunManifest | undefined,
): Promise<void> {
  let branch = d.load().branch ?? manifest?.branch;
  if (requiresPrBranchAdoption(branch, manifest)) branch = await adoptExistingPrBranch(d, manifest);
  await recoverOrCheckoutWorker(d, issue, manifest, branch);
  status(d, issue.number, 'worker_recovery_pending', {
    pr: d.load().pr,

    workerRecoveryCount: d.load().workerRecoveryCount ?? 0,
  });
  d.comment(
    issue.number,
    'Dispatcher detectó un Worker perdido y levantará una ejecución de recovery.',
  );
  if (claimed) publishRemoteManifest(cfg, d, issue.number, 'working', claimed);
}

function requiresPrBranchAdoption(branch: string | undefined, manifest: RunManifest | undefined) {
  return !branch || branch === 'pending' || manifest?.branch === 'pending';
}

async function adoptExistingPrBranch(
  d: Deps,
  manifest: RunManifest | undefined,
): Promise<string | undefined> {
  const existingPr = d.load().pr ?? manifest?.pr;
  if (!existingPr) return undefined;
  const evidence = await d.pullRequest(existingPr);
  if (evidence.state?.toUpperCase() !== 'OPEN' || !evidence.headRefName) return undefined;
  d.save({
    ...d.load(),

    pr: evidence.number,

    branch: evidence.headRefName,

    headSha: evidence.headRefOid,
  });
  return evidence.headRefName;
}

async function recoverOrCheckoutWorker(
  d: Deps,
  issue: Issue,
  manifest: RunManifest | undefined,
  branch: string | undefined,
): Promise<void> {
  const runId = d.load().workerRunId ?? manifest?.runId ?? '';
  const recovered = await d.workspaceAdapter?.recover(issue.number, runId, branch);
  if (recovered) {
    validateRecoveredWorkerBranch(branch, recovered.branch);
    return;
  }
  requirePersistedWorkerBranch(issue.number, branch);
  d.checkoutWorkerBranch(branch);
}

function validateRecoveredWorkerBranch(
  expectedBranch: string | undefined,
  recoveredBranch: string,
): void {
  if (expectedBranch && recoveredBranch !== expectedBranch)
    throw new Error(
      `recovery workspace branch does not match remote branch ${expectedBranch}; found ${recoveredBranch}`,
    );
}

function requirePersistedWorkerBranch(
  issue: number,
  branch: string | undefined,
): asserts branch is string {
  if (!branch || branch === 'pending')
    throw new Error(
      `recovery requires persisted worker branch for issue #${issue}; remote worker branch was ${branch ?? 'none'}`,
    );
}

async function prepareWorkerWorkspace(
  cfg: Config,
  d: Deps,
  issue: Issue,
  runId: string,
  isRecovery: boolean,
  manifest: RunManifest | undefined,
): Promise<RunManifest | undefined> {
  const key = artifactKey('run', { issue: issue.number, runId });
  const claimResult = ensureRemoteClaim(
    cfg,
    d,
    issue.number,
    runId,
    key,
    isRecovery && manifest?.branch !== 'pending' ? manifest : undefined,
  );
  if (!claimResult.ok) throw claimResult.error;
  const claimed = claimResult.value;
  if (isRecovery) {
    await prepareRecoveryWorker(cfg, d, issue, claimed, manifest);
    return claimed;
  }
  prepareFreshWorker(cfg, d, issue, runId, claimed);
  return claimed;
}

export const DispatchWorkspace = {
  prepareWorkerWorkspace,

  prepareRecoveryWorker,
};
