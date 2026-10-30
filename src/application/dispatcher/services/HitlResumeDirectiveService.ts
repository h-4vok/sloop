/** Coordinates hitl resume directive service operations for dispatcher workflows. */
import type { State } from '../../../application/dispatcher/types/index.js';
import type { RemoteSnapshot } from '../../../remote-state.js';
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { isWorkerStatus, status } = RunStatePolicy;
import type { HitlResumeDirective } from '../types/HitlResumeDirective.js';

function activeRunForHitl(
  state: State,
  processAlive: (pid: number) => boolean,
): Required<Pick<State, 'issue' | 'pr'>> & State {
  const staleWorker =
    isWorkerStatus(state.status) &&
    typeof state.workerPid === 'number' &&
    !processAlive(state.workerPid);
  if (
    (!['review_cap_pending', 'worker_recovery_pending'].includes(state.status ?? '') &&
      !staleWorker) ||
    !state.issue ||
    !state.pr
  )
    throw new Error(
      'HITL resolution requires one active review-cap/recovery run, or a stale Worker, with an existing PR',
    );
  return state as Required<Pick<State, 'issue' | 'pr'>> & State;
}

function hitlResumeDirective(
  snapshot: RemoteSnapshot,
  issue: number,
  pr: number,
): HitlResumeDirective | undefined {
  const candidates = (snapshot.comments ?? []).flatMap(({ body, createdAt, id }, index) => {
    const match = body?.match(
      /^\[HITL Review Cap\] action=resume issue=#(\d+) pr=#(\d+) round=(\d+) sha=(\S+) waived=(\S+) additionalRounds=(\d+) steer=(.*)$/m,
    );
    if (!match || Number(match[1]) !== issue || Number(match[2]) !== pr) return [];
    return [
      {
        index,

        createdAt: createdAt ? Date.parse(createdAt) : undefined,

        id,

        value: {
          issue,

          pr,

          round: Number(match[3]),

          sha: match[4],

          waivedFindingIds: match[5] === 'none' ? [] : match[5].split(','),

          additionalRounds: Number(match[6]),

          steer: match[7],
        },
      },
    ];
  });
  return candidates
    .sort(
      (a, b) =>
        a.value.round - b.value.round ||
        (a.createdAt ?? a.id ?? a.index) - (b.createdAt ?? b.id ?? b.index),
    )
    .at(-1)?.value;
}

export const HitlResumeDirectiveService = {
  activeRunForHitl,

  hitlResumeDirective,
};
