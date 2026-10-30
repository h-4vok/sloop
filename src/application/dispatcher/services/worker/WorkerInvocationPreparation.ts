import type { Config, Deps, Issue } from '../../types/index.js';
import { AgentRoles } from '../AgentRoles.js';
const { roleCommand, appendWorkerRoundContext, rolePrompt, roleUpdate } = AgentRoles;
import { PullRequestPublisher } from '../PullRequestPublisher.js';
const { withIssueClosingReference } = PullRequestPublisher;
import { WorkerLifecycle } from '../WorkerLifecycle.js';
const { withWorkerLifecycle } = WorkerLifecycle;

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

export const WorkerInvocationPreparation = { createWorkerInvocation };
