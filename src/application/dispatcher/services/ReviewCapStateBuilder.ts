import type { Config, DispatcherHost, State } from '../types/index.js';
import { ReviewBudget } from './ReviewBudget.js';
const { maxRoundsForUserBudget } = ReviewBudget;
import { GitHubCli } from './GitHubCli.js';
const { gh } = GitHubCli;

function buildReviewCapState(
  current: State,
  reviewCap: NonNullable<State['reviewCap']>,
  options: { steer: string; additionalRounds: number },
  waivedFindingIds: readonly string[],
  cfg: Config,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
) {
  const baseMaxRounds = cfg.maxReviewRounds ?? 10;
  const requestedMaxRounds = maxRoundsForUserBudget(
    baseMaxRounds,
    current.reviewRound ?? 1,
    options.additionalRounds,
  );

  return {
    ...reviewCap,

    additionalRounds: Math.max(0, requestedMaxRounds - baseMaxRounds),

    waivedFindingIds: [
      ...new Set([...(current.reviewCap?.waivedFindingIds ?? []), ...waivedFindingIds]),
    ],

    steer: options.steer.trim(),

    resolvedBy: gh(['api', 'user', '--jq', '.login'], cwd, repository, host),

    resolvedAt: new Date(host.now?.() ?? Date.now()).toISOString(),
  };
}

/** Builds the persisted cap decision after waiver validation. */
export const ReviewCapStateBuilder = {
  buildReviewCapState,
};
