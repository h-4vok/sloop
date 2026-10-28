import type { Command } from './Command.js';

/** Dispatcher settings needed by issue, agent, and review workflows. */
export type Config = {
  baseBranch?: string;
  workerCommand?: Command;
  qaCommand?: Command;
  arbiterCommand?: Command;
  arbiterReviewRounds?: number;
  arbiterStagnatingAppearances?: number;
  arbiterDecisionLimit?: number;
  checkPollIntervalMs?: number;
  checkTimeoutMs?: number;
  evidencePollIntervalMs?: number;
  evidenceTimeoutMs?: number;
  workerLeaseMs?: number;
  maxReviewRounds?: number;
  logRoleInvocation?: boolean;
  loggingRetentionMs?: number;
  lockTtlMs?: number;
  priorityLabels?: readonly string[];
};
