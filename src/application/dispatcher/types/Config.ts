import type { Command } from './Command.js';

/** Dispatcher settings needed by issue, agent, and review workflows. */
export type Config = {
  readonly baseBranch?: string;
  readonly workerCommand?: Command;
  readonly qaCommand?: Command;
  readonly arbiterCommand?: Command;
  readonly arbiterReviewRounds?: number;
  readonly arbiterStagnatingAppearances?: number;
  readonly arbiterDecisionLimit?: number;
  readonly checkPollIntervalMs?: number;
  readonly checkTimeoutMs?: number;
  readonly evidencePollIntervalMs?: number;
  readonly evidenceTimeoutMs?: number;
  readonly workerLeaseMs?: number;
  readonly maxReviewRounds?: number;
  readonly logRoleInvocation?: boolean;
  readonly loggingRetentionMs?: number;
  readonly lockTtlMs?: number;
  readonly priorityLabels?: readonly string[];
};
