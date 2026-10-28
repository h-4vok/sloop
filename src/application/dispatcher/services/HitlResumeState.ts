import type { State } from '../types/index.js';
import type { RemoteSnapshot } from '../../../remote-state.js';
import type { HitlResumeDirective } from '../types/HitlResumeDirective.js';
import { ReviewBudget } from './ReviewBudget.js';
const { maxRoundsForUserBudget } = ReviewBudget;

function reviewCap(
  current: State,
  snapshot: RemoteSnapshot,
  directive: HitlResumeDirective,
  baseMaxRounds: number,
) {
  const outstandingFindingIds =
    current.reviewCap?.outstandingFindingIds ??
    (snapshot.comments ?? [])
      .flatMap(({ body }) => {
        const match = body?.match(
          new RegExp(
            `^\\[HITL Review Cap\\] round=${directive.round}\\b.*? outstanding=([^\\s.]+)`,
            'm',
          ),
        );
        return match ? [match[1]] : [];
      })
      .at(-1)
      ?.split(',')
      .filter((id) => id !== 'none') ??
    [];

  return {
    capRound: baseMaxRounds,
    decisionSha: directive.sha,
    outstandingFindingIds,
    additionalRounds: Math.max(
      0,
      maxRoundsForUserBudget(baseMaxRounds, directive.round, directive.additionalRounds) -
        baseMaxRounds,
    ),
    waivedFindingIds: directive.waivedFindingIds,
    steer: directive.steer,
  };
}

/** Rebuilds review-cap state from a validated human resume directive. */
export const HitlResumeState = {
  reviewCap,
};
