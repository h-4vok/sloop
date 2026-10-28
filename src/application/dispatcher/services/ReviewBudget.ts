/** Coordinates review budget operations for dispatcher workflows. */
import type { Config, State } from '../../../application/dispatcher/types/index.js';

function effectiveMaxRounds(cfg: Config, state: State): number {
  return (cfg.maxReviewRounds ?? 10) + (state.reviewCap?.additionalRounds ?? 0);
}

function maxRoundsForUserBudget(
  baseMaxRounds: number,
  currentRound: number,
  requestedAdditionalRounds: number,
): number {
  if (!Number.isSafeInteger(baseMaxRounds) || baseMaxRounds < 0)
    throw new Error('base review-round limit must be a non-negative integer');
  if (!Number.isSafeInteger(currentRound) || currentRound < 1)
    throw new Error('current review round must be a positive integer');
  if (!Number.isSafeInteger(requestedAdditionalRounds) || requestedAdditionalRounds < 0)
    throw new Error('additional review rounds must be a non-negative integer');
  return requestedAdditionalRounds === 0
    ? baseMaxRounds
    : Math.max(baseMaxRounds, currentRound + requestedAdditionalRounds - 1);
}

function findingIds(feedback: string): string[] {
  return [
    ...new Set(
      feedback
        .split(/\r?\n/)
        .filter((line) =>
          /\[([QSH]\d+)\]\s+(?:fail|blocked|high|critical|medium|low)\b/i.test(line),
        )
        .map((line) => line.match(/\[([QS]\d+)\]/i)?.[1].toUpperCase())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

export const ReviewBudget = {
  effectiveMaxRounds,
  maxRoundsForUserBudget,
  findingIds,
};
