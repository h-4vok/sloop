/** Runs QA and accepts evidence published against the reviewed commit. */
import type { Config, Deps, Issue, PullRequest, Status } from '../../types/index.js';
import { RunLogger, runDirectory } from '../../../../run-log.js';
import { allowlistedPublication } from '../../../../publication.js';
import { ReviewEvidence } from './ReviewEvidence.js';
const { latestReview, reviewVerdict, waitForEvidence } = ReviewEvidence;
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { AgentRoles } from '../AgentRoles.js';
const { roleCommand, roleUpdate, rolePrompt } = AgentRoles;
import { AgentInvocation } from '../AgentInvocation.js';
const { runRoleLogged } = AgentInvocation;

async function runReview(
  cfg: Config,
  d: Deps,
  issue: Issue,
  role: 'qa',
  prNumber: number,
  round: number,
  evidence: PullRequest,
): Promise<{ verdict?: string; body?: string; evidence: PullRequest }> {
  const marker = '[QA/SDET Review]';
  const expectedHead = evidence.headRefOid;
  const existing = latestReview(evidence, marker, round, expectedHead);
  if (existing) return { verdict: reviewVerdict(existing.body), body: existing.body, evidence };

  status(d, issue.number, 'qa_review_pending', { pr: prNumber, headSha: expectedHead });
  await executeQaReview(cfg, d, issue, role, prNumber, round, expectedHead);
  const latest = await waitForEvidence(
    d,
    cfg,
    prNumber,
    (candidate) =>
      candidate.headRefOid !== expectedHead ||
      Boolean(latestReview(candidate, marker, round, expectedHead)),
  );
  const review = requireCurrentReview(latest, marker, role, prNumber, round, expectedHead);
  return {
    verdict: reviewVerdict(review.body),

    body: review.body,

    evidence: latest,
  };
}

async function executeQaReview(
  cfg: Config,
  d: Deps,
  issue: Issue,
  role: 'qa',
  prNumber: number,
  round: number,
  expectedHead: string | undefined,
): Promise<string> {
  const spec = requireQaCommand(cfg, issue, role);
  const state = d.load();
  const runId = state.workerRunId ?? `review-${round}`;
  const taskContext = state.taskContext ?? '';
  const lastQaFeedback = state.lastQaFeedback ?? '';
  const logger = startQaReviewLogger(d, issue, runId, prNumber, round, role);
  const progress = roleUpdate('qa', taskContext, lastQaFeedback);
  const prompt = rolePrompt(
    issue,
    role,
    prNumber,
    round,
    taskContext,
    lastQaFeedback,
    expectedHead,
    runId,
  );
  const output = await runRoleLogged(
    d,
    logger,
    role,
    issue,
    runId,
    { ...spec },
    progress,
    '',
    '',
    prompt,
  );
  logger.write('result', { role, output: allowlistedPublication(output) });

  return output;
}

function requireQaCommand(cfg: Config, issue: Issue, role: 'qa') {
  const configured = cfg.qaCommand;
  if (!configured) throw new Error(`${role} command is required`);
  const spec = roleCommand(configured, issue.number, cfg);
  if (!spec) throw new Error(`${role} command is required`);

  return spec;
}

function startQaReviewLogger(
  d: Deps,
  issue: Issue,
  runId: string,
  prNumber: number,
  round: number,
  role: 'qa',
): RunLogger {
  const logger = new RunLogger(runDirectory(d.root, issue.number, runId));
  d.setRunLogger?.(logger);
  logger.write(
    'context',
    d.runContext?.() ?? { originalRepository: d.root, executionRoot: d.root },
  );
  logger.write('transition', { phase: role, round, pr: prNumber });
  logger.write('prompt', { role, round });

  return logger;
}

function requireCurrentReview(
  evidence: PullRequest,
  marker: '[QA/SDET Review]',
  role: 'qa',
  prNumber: number,
  round: number,
  expectedHead: string | undefined,
) {
  if (evidence.headRefOid !== expectedHead)
    throw new Error(
      `QA evidence is stale: PR #${prNumber} HEAD changed from ${expectedHead} to ${evidence.headRefOid}`,
    );
  const review = latestReview(evidence, marker, round, expectedHead);
  if (!review)
    throw new Error(
      `${role} exited successfully but did not publish ${marker} evidence matching the current context on PR #${prNumber} for round=${round} commit=${expectedHead}; checked PR comments and GitHub reviews for marker, round, commit and verdict`,
    );

  return review;
}

export const ReviewExecution = {
  runReview,
};
