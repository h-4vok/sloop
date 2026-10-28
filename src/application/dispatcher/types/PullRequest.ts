import type { Check } from './Check.js';
import type { Review } from './Review.js';

/** Pull request snapshot consumed by dispatcher workflow policies. */
export type PullRequest = {
  number: number;
  state?: string;
  baseRefOid?: string;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  body?: string;
  mergeStateStatus?: string;
  mergeable?: string;
  reviews?: Review[];
  comments?: Array<{ body?: string; createdAt?: string }>;
  statusCheckRollup?: Check[];
};
