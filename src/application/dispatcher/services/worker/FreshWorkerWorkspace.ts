import type { Config, Deps, Issue, State } from '../../types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { claimNewIssue } = RunStatePolicy;
import { RemoteManifestPublisher } from '../RemoteManifestPublisher.js';
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
  d.save({ ...d.load(), ...preparedWorkerState(prepared) });
  if (claimed) publishRemoteManifest(cfg, d, issue.number, 'working', claimed);
}

function preparedWorkerState(
  prepared:
    | ReturnType<NonNullable<Deps['workspaceAdapter']>['prepare']>
    | ReturnType<Deps['prepareWorkerBranch']>,
): Partial<State> {
  return {
    branch: prepared.branch,

    mainBaseSha: 'baseSha' in prepared ? prepared.baseSha : prepared.mainBaseSha,

    ...('headSha' in prepared ? { headSha: prepared.headSha } : {}),

    ...('ownership' in prepared ? { workerRunId: prepared.ownership.runId } : {}),
  };
}

export const FreshWorkerWorkspace = { prepareFreshWorker };
