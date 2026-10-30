/** Coordinates remote run state operations for dispatcher workflows. */
import type { Deps, Config } from '../../../../application/dispatcher/types/index.js';
import { artifactKey, projectRemoteState } from '../../../../remote-state.js';
import type { RunManifest, WorkflowProjection } from '../../../../remote-state.js';
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

export const RemoteRunState = {
  remoteOwner,

  remoteConfigFingerprint,

  remoteManifest,

  remoteProjection,

  hydrateFromRemote,
};
