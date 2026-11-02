import type { Config, Deps } from '../../../../application/dispatcher/types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
function pullRequestField(phase: RunManifest['phase'], state: ReturnType<Deps['load']>) {
  if (phase === 'claimed' || !state.pr) return {};

  return { pr: state.pr };
}

function manifestBranch(
  phase: RunManifest['phase'],
  state: ReturnType<Deps['load']>,
  previous?: Partial<RunManifest>,
) {
  if (phase === 'claimed') return 'pending';

  return state.branch ?? previous?.branch ?? 'pending';
}

function manifestBaseSha(
  phase: RunManifest['phase'],
  state: ReturnType<Deps['load']>,
  previous?: Partial<RunManifest>,
) {
  if (phase === 'claimed') return '0000000';

  return state.mainBaseSha ?? previous?.baseSha ?? '0000000';
}

/** Creates the recovery state fields added to remote run manifests. */
export const createRemoteManifestFields = Object.freeze({
  identity(
    phase: RunManifest['phase'],
    state: ReturnType<Deps['load']>,
    previous?: Partial<RunManifest>,
  ) {
    return {
      ...pullRequestField(phase, state),
      branch: manifestBranch(phase, state, previous),
      baseSha: manifestBaseSha(phase, state, previous),
    };
  },

  lease(leaseOwner: string | undefined, cfg: Config, d: Deps): { lease?: RunManifest['lease'] } {
    if (!leaseOwner) return {};

    return {
      lease: {
        owner: leaseOwner,

        expiresAt: new Date(d.now() + (cfg.workerLeaseMs ?? 900000)).toISOString(),
      },
    };
  },
});
