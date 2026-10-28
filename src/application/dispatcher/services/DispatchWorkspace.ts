import type { Config, Deps, Issue, State } from '../types/index.js';
import type { RunManifest } from '../../../remote-state.js';
import { artifactKey } from '../../../remote-state.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;
import { RemoteClaim } from './RemoteClaim.js';
const { ensureRemoteClaim } = RemoteClaim;
const { claimNewIssue } = RemoteClaim;
import { RemoteManifestPublisher } from './RemoteManifestPublisher.js';
const { publishRemoteManifest } = RemoteManifestPublisher;

function prepareFreshWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  runId: string,
  claimed: RunManifest | undefined,
): void {
  claimNewIssue(d, issue.number);
  d.save({ ...d.load(), workerRunId: claimed?.runId ?? runId });
  const prepared = d.workspaceAdapter
    ? d.workspaceAdapter.prepare(issue.number)
    : d.prepareWorkerBranch(issue.number);
  d.save({
    ...d.load(),

    branch: prepared.branch,

    mainBaseSha: 'baseSha' in prepared ? prepared.baseSha : prepared.mainBaseSha,

    ...('headSha' in prepared ? { headSha: prepared.headSha } : {}),

    ...('ownership' in prepared ? { workerRunId: prepared.ownership.runId } : {}),
  });
  if (claimed) publishRemoteManifest(cfg, d, issue.number, 'working', claimed);
}

async function prepareRecoveryWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  claimed: RunManifest | undefined,
  manifest: RunManifest | undefined,
): Promise<void> {
  let branch = d.load().branch ?? manifest?.branch;
  if (!branch || branch === 'pending' || manifest?.branch === 'pending')
    branch = await adoptExistingPrBranch(d, manifest);
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
    if (branch && recovered.branch !== branch)
      throw new Error(
        `recovery workspace branch does not match remote branch ${branch}; found ${recovered.branch}`,
      );
    return;
  }
  if (!branch || branch === 'pending')
    throw new Error(
      `recovery requires persisted worker branch for issue #${issue.number}; remote worker branch was ${branch ?? 'none'}`,
    );
  d.checkoutWorkerBranch(branch);
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
  const claimed = ensureRemoteClaim(
    cfg,
    d,
    issue.number,
    runId,
    key,
    isRecovery && manifest?.branch !== 'pending' ? manifest : undefined,
  );
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
