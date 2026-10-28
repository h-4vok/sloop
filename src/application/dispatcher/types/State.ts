import type { ArbiterDecision } from '../../../arbiter-contracts.js';
import type { Status } from './Status.js';

/** Persisted state needed to resume an issue workflow. */
export type State = {
  issue?: number;
  status?: Status;
  pr?: number;
  branch?: string;
  mainBaseSha?: string;
  headSha?: string;
  reviewRound?: number;
  attempt?: number;
  mainGreen?: boolean;
  /** Brief failure explanation retained for legacy readers. */
  lastError?: string;
  /** Full redacted diagnostic, shown only by --status --verbose. */
  lastErrorVerbose?: string;
  lastCiFeedback?: string;
  lastQaFeedback?: string;
  taskContext?: string;
  workerRunId?: string;
  workerPid?: number;
  workerStartedAt?: number;
  workerHeartbeatAt?: number;
  workerRecoveryCount?: number;
  preparedRecovery?: boolean;
  linkedClosingIssues?: number[];
  reviewCap?: {
    capRound: number;
    decisionSha?: string;
    outstandingFindingIds: string[];
    additionalRounds: number;
    waivedFindingIds: string[];
    steer?: string;
    resolvedBy?: string;
    resolvedAt?: string;
  };
  arbiterInterventions?: number;
  arbiterDecisions?: readonly ArbiterDecision[];
  arbiterFollowUps?: Readonly<Record<string, number>>;
  arbiterFollowUpEligibility?: Readonly<Record<string, boolean>>;
  arbiterTerminal?: 'human_review_required';
  abandonment?: {
    steer: string;
    commentPublished?: boolean;
    prClosed?: boolean;
    labelled?: boolean;
    issueClosed?: boolean;
  };
  completedIssues?: number[];
  drainStatus?: 'running' | 'done';
  updatedAt?: number;
};
