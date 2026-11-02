/** Coordinates hitl resume directive service operations for dispatcher workflows. */
import type { State } from '../../types/index.js';
import type { RemoteSnapshot } from '../../../../remote-state.js';
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { isWorkerStatus, status } = RunStatePolicy;
import type { HitlResumeDirective } from '../../types/HitlResumeDirective.js';

function activeRunForHitl(
  state: State,
  processAlive: (pid: number) => boolean,
): Required<Pick<State, 'issue' | 'pr'>> & State {
  if (!hasResolvableHitlStatus(state, processAlive) || !state.issue || !state.pr)
    throw new Error(
      'HITL resolution requires one active review-cap/recovery run, or a stale Worker, with an existing PR',
    );
  return state as Required<Pick<State, 'issue' | 'pr'>> & State;
}

function hasResolvableHitlStatus(state: State, processAlive: (pid: number) => boolean): boolean {
  if (state.status === 'review_cap_pending' || state.status === 'worker_recovery_pending')
    return true;
  if (!isWorkerStatus(state.status)) return false;
  if (typeof state.workerPid !== 'number') return false;

  return !processAlive(state.workerPid);
}

type HitlResumeCandidate = {
  index: number;
  createdAt?: number;
  id?: number;
  value: HitlResumeDirective;
};

function hitlResumeDirective(
  snapshot: RemoteSnapshot,
  issue: number,
  pr: number,
): HitlResumeDirective | undefined {
  const candidates = (snapshot.comments ?? []).flatMap((comment, index) =>
    parseHitlResumeComment(comment, index, issue, pr),
  );

  return candidates.sort(compareHitlResumeCandidates).at(-1)?.value;
}

function parseHitlResumeComment(
  comment: NonNullable<RemoteSnapshot['comments']>[number],
  index: number,
  issue: number,
  pr: number,
): HitlResumeCandidate[] {
  const match = comment.body?.match(
    /^\[HITL Review Cap\] action=resume issue=#(\d+) pr=#(\d+) round=(\d+) sha=(\S+) waived=(\S+) additionalRounds=(\d+) steer=(.*)$/m,
  );
  if (!match) return [];
  if (Number(match[1]) !== issue) return [];
  if (Number(match[2]) !== pr) return [];

  return [createHitlResumeCandidate(comment, index, issue, pr, match)];
}

function createHitlResumeCandidate(
  comment: NonNullable<RemoteSnapshot['comments']>[number],
  index: number,
  issue: number,
  pr: number,
  match: RegExpMatchArray,
): HitlResumeCandidate {
  return {
    index,

    createdAt: comment.createdAt ? Date.parse(comment.createdAt) : undefined,

    id: comment.id,

    value: {
      issue,

      pr,

      round: Number(match[3]),

      sha: match[4],

      waivedFindingIds: match[5] === 'none' ? [] : match[5].split(','),

      additionalRounds: Number(match[6]),

      steer: match[7],
    },
  };
}

function compareHitlResumeCandidates(a: HitlResumeCandidate, b: HitlResumeCandidate): number {
  if (a.value.round !== b.value.round) return a.value.round - b.value.round;

  return (a.createdAt ?? a.id ?? a.index) - (b.createdAt ?? b.id ?? b.index);
}

export const HitlResumeDirectiveService = {
  activeRunForHitl,

  hitlResumeDirective,
};
