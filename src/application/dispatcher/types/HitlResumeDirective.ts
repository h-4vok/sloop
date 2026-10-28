/** Validated human instruction for resuming a capped review workflow. */
export type HitlResumeDirective = {
  issue: number;
  pr: number;
  round: number;
  sha: string;
  waivedFindingIds: string[];
  additionalRounds: number;
  steer: string;
};
