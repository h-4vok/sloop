import { randomUUID } from 'node:crypto';
import type { Config, Deps, Issue } from '../../types/index.js';
import { RunLogger, runDirectory } from '../../../../run-log.js';
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { WorkerInvocationPreparation } from './WorkerInvocationPreparation.js';
const { createWorkerInvocation } = WorkerInvocationPreparation;

function validateWorkerConfiguration(cfg: Config): void {
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'main')
    throw new Error(`Worker PR baseBranch must be main; found ${cfg.baseBranch}`);
  if (!cfg.workerCommand) throw new Error('workerCommand is required');
}

async function validateRecoverableWorkerPr(d: Deps, pr: number | undefined): Promise<void> {
  if (!pr) return;

  const evidence = await d.pullRequest(pr);
  validateRecoverableWorkerPrEvidence(evidence, pr);

  const expectedBranch = d.load().branch;
  if (expectedBranch && evidence.headRefName !== expectedBranch)
    throw new Error(
      `refusing to launch Worker for PR #${pr}: PR #${pr} must use worker branch ${expectedBranch}; found ${evidence.headRefName}`,
    );

  if (!expectedBranch)
    d.save({ ...d.load(), branch: evidence.headRefName, headSha: evidence.headRefOid });
}

function validateRecoverableWorkerPrEvidence(
  evidence: Awaited<ReturnType<Deps['pullRequest']>>,
  pr: number,
): void {
  if (evidence.state?.toUpperCase() !== 'OPEN' || !evidence.headRefName)
    throw new Error(`PR #${pr} has no recoverable open head branch`);
}

function startWorkerRun(cfg: Config, d: Deps, issue: Issue, round: number, pr: number | undefined) {
  const runId = randomUUID();
  const logger = new RunLogger(runDirectory(d.root, issue.number, runId));
  d.setRunLogger?.(logger);
  logger.write(
    'context',
    d.runContext?.() ?? { originalRepository: d.root, executionRoot: d.root },
  );
  logger.write('transition', { phase: 'worker', round, issue: issue.number, pr });
  status(d, issue.number, 'worker_recovery_pending', {
    workerRunId: runId,

    workerRecoveryCount: (d.load().workerRecoveryCount ?? 0) + 1,

    reviewRound: round,

    lastError: undefined,

    lastErrorVerbose: undefined,
  });

  return { runId, logger };
}

export const WorkerStartup = {
  validateWorkerConfiguration,

  validateRecoverableWorkerPr,

  startWorkerRun,

  createWorkerInvocation,
};
