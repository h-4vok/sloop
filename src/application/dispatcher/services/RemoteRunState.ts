/** Coordinates remote run state operations for dispatcher workflows. */
import type { Deps, Config, PullRequest } from '../../../application/dispatcher/types/index.js';
import { artifactKey, projectRemoteState } from '../../../remote-state.js';
import type { RunManifest, WorkflowProjection } from '../../../remote-state.js';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequest } = PullRequestReader;

function remoteOwner(d: Deps, issue: number): string {
  return `${d.pid()}:${issue}`;
}

function remoteConfigFingerprint(cfg: Config): string {
  return artifactKey('config', {
    baseBranch: cfg.baseBranch ?? 'main',

    workerCommand: cfg.workerCommand ?? null,

    qaCommand: cfg.qaCommand ?? null,
  });
}

function remoteManifest(
  cfg: Config,
  d: Deps,
  issue: number,
  runId: string,
  key: string,
  phase: RunManifest['phase'],
  leaseOwner?: string,
  previous?: Partial<RunManifest>,
): RunManifest {
  const state = d.load();
  return {
    protocol: 1,

    runId,

    issue,

    ...(phase !== 'claimed' && state.pr ? { pr: state.pr } : {}),

    branch: phase === 'claimed' ? 'pending' : (state.branch ?? previous?.branch ?? 'pending'),

    baseSha:
      phase === 'claimed' ? '0000000' : (state.mainBaseSha ?? previous?.baseSha ?? '0000000'),

    configFingerprint: remoteConfigFingerprint(cfg),

    phase,

    ...(leaseOwner
      ? {
          lease: {
            owner: leaseOwner,

            expiresAt: new Date(d.now() + (cfg.workerLeaseMs ?? 900000)).toISOString(),
          },
        }
      : {}),

    reviewRound: state.reviewRound ?? previous?.reviewRound ?? 1,

    contextCursor: previous?.contextCursor ?? '',

    artifacts: [...new Set([...(previous?.artifacts ?? []), key])],
  };
}

function remoteProjection(
  d: Deps,
  issue: number,
):
  | {
      projection: WorkflowProjection;
      snapshot: ReturnType<NonNullable<Deps['remote']>['snapshot']>;
    }
  | undefined {
  if (!d.remote) return undefined;
  const snapshot = d.remote.snapshot(issue);
  return { snapshot, projection: projectRemoteState(snapshot) };
}

function hydrateFromRemote(d: Deps, manifest: RunManifest): void {
  const current = d.load();
  d.save({
    ...current,

    issue: manifest.issue,

    pr: manifest.pr,

    branch: manifest.branch === 'pending' ? current.branch : manifest.branch,

    mainBaseSha: manifest.baseSha === '0000000' ? current.mainBaseSha : manifest.baseSha,

    workerRunId: manifest.runId,

    reviewRound: manifest.reviewRound,

    status: manifest.phase === 'review' ? 'worker_ready_for_review' : 'worker_recovery_pending',

    preparedRecovery: undefined,

    updatedAt: d.now(),
  });
}

async function preparedRecoveryPullRequest(
  d: Deps,
  cfg: Config,
  issue: number,
  manifest: RunManifest,
): Promise<PullRequest | undefined> {
  const state = d.load();
  if (!state.preparedRecovery || state.issue !== issue || !state.pr) return undefined;
  const preparedPr = state.pr;
  const fail = (reason: string): never => {
    throw new Error(`prepared recovery PR #${preparedPr} failed validation: ${reason}`);
  };
  const evidence = await d.pullRequest(preparedPr);
  if (evidence.number !== preparedPr)
    return fail('PR identity does not match local recovery state');
  if (evidence.state?.toUpperCase() !== 'OPEN') return fail('PR is not open');
  if (evidence.baseRefName !== (cfg.baseBranch ?? 'main'))
    return fail(`PR base must be ${cfg.baseBranch ?? 'main'}`);
  if (!state.branch || evidence.headRefName !== state.branch)
    return fail('PR head branch does not match the persisted recovery branch');
  if (manifest.branch !== 'pending' && manifest.branch !== state.branch)
    return fail('remote manifest branch does not match the persisted recovery branch');
  if (manifest.pr !== undefined && manifest.pr !== preparedPr)
    return fail('remote manifest PR identity conflicts with local recovery state');
  if (!evidence.headRefOid) return fail('PR has no recoverable head commit');
  const closesIssue = new RegExp(
    `^\\s*(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+#${issue}\\b\\s*$`,
    'im',
  ).test(evidence.body ?? '');
  if (!closesIssue) return fail(`PR body does not associate it with issue #${issue}`);
  return evidence;
}

export const RemoteRunState = {
  remoteOwner,

  remoteConfigFingerprint,

  remoteManifest,

  remoteProjection,

  hydrateFromRemote,

  preparedRecoveryPullRequest,
};
