/** User decisions applied when resuming a review-cap pause. */
export type ReviewCapOptions = Readonly<{
  steer: string;
  additionalRounds: number;
  waivedFindingIds: readonly string[];
  waiveAllOutstanding: boolean;
  abandon: boolean;
}>;
