/** Coordinates review cap policy operations for dispatcher workflows. */
import type { PullRequest, Config } from '../../../application/dispatcher/types/index.js';
import { CiEvidence } from './CiEvidence.js';
const { ciState } = CiEvidence;

function prHealthyForHumanMerge(pr: PullRequest, cfg: Config): boolean {
  const checks = pr.statusCheckRollup ?? [];
  return (
    pr.mergeable?.toUpperCase() !== 'CONFLICTING' &&
    pr.mergeStateStatus?.toUpperCase() !== 'DIRTY' &&
    ciState(checks) === 'green'
  );
}

export const ReviewCapPolicy = {
  prHealthyForHumanMerge,
};
