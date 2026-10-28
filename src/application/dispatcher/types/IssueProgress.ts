/** Mutable-in-time but immutable-by-value context for one issue's review cycle. */
export type IssueProgress = { round: number; pr?: number; feedback: string };
