import type { IssueProgress } from './IssueProgress.js';

/** Result of one CI/QA pass through the issue workflow. */
export type IssueRoundResult = { continueWith: IssueProgress } | { finished: true };
