import { randomUUID } from 'node:crypto';
import type { Config, Deps, Issue } from '../types/index.js';
import { RunLogger, runDirectory } from '../../../run-log.js';
import { RunStatePolicy } from './state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { AgentRoles } from './AgentRoles.js';
const { roleCommand, appendWorkerRoundContext, rolePrompt, roleUpdate } = AgentRoles;
import { PullRequestPublisher } from './PullRequestPublisher.js';
const { withIssueClosingReference } = PullRequestPublisher;
import { WorkerLifecycle } from './WorkerLifecycle.js';
const { withWorkerLifecycle } = WorkerLifecycle;

function validateWorkerConfiguration(cfg: Config): void {
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'main')
    throw new Error(`Worker PR baseBranch must be main; found ${cfg.baseBranch}`);
  if (!cfg.workerCommand) throw new Error('workerCommand is required');
}

async function validateRecoverableWorkerPr(d: Deps, pr: number | undefined): Promise<void> {
  if (!pr) return;

  const evidence = await d.pullRequest(pr);
  if (evidence.state?.toUpperCase() !== 'OPEN' || !evidence.headRefName)
    throw new Error(`PR #${pr} has no recoverable open head branch`);

  const expectedBranch = d.load().branch;
  if (expectedBranch && evidence.headRefName !== expectedBranch)
    throw new Error(
      `refusing to launch Worker for PR #${pr}: PR #${pr} must use worker branch ${expectedBranch}; found ${evidence.headRefName}`,
    );

  if (!expectedBranch)
    d.save({ ...d.load(), branch: evidence.headRefName, headSha: evidence.headRefOid });
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

function createWorkerPrompt(
  d: Deps,
  issue: Issue,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
  runId: string,
  initialPrBody: string,
): string {
  const state = d.load();
  appendWorkerRoundContext(
    d.root,
    issue.number,
    round,
    pr,
    context,
    feedback,
    state.reviewCap?.steer,
  );

  return rolePrompt(
    issue,
    'worker',
    pr,
    round,
    context,
    feedback,
    state.headSha,
    runId,
    initialPrBody,
  );
}

function createWorkerInvocation(
  cfg: Config,
  d: Deps,
  issue: Issue,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
  runId: string,
) {
  const configuredCommand = cfg.workerCommand;
  if (!configuredCommand) throw new Error('workerCommand is required');
  const spec = roleCommand(configuredCommand, issue.number, cfg);
  if (!spec) throw new Error('workerCommand is required');

  const initialPrBody = withIssueClosingReference(
    '',
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  const prompt = createWorkerPrompt(d, issue, round, pr, context, feedback, runId, initialPrBody);
  const workerSpec = withWorkerLifecycle(
    d,
    {
      ...spec,

      env: {
        ...spec.env,

        SLOOP_ISSUE_NUMBER: String(issue.number),

        SLOOP_PR_BODY: initialPrBody,
      },

      input: prompt,
    },
    issue.number,
    runId,
  );
  const progress = roleUpdate('worker', context, feedback);

  return { spec: workerSpec, initialPrBody, prompt, progress };
}

export const WorkerStartup = {
  validateWorkerConfiguration,

  validateRecoverableWorkerPr,

  startWorkerRun,

  createWorkerInvocation,
};
