import type { Config, Deps, Issue } from '../types/index.js';
import { allowlistedPublication } from '../../../publication.js';
import { AgentInvocation } from './AgentInvocation.js';
const { runRoleLogged } = AgentInvocation;
import { WorkerStartup } from './WorkerStartup.js';
const {
  validateWorkerConfiguration,
  validateRecoverableWorkerPr,
  startWorkerRun,
  createWorkerInvocation,
} = WorkerStartup;
import { WorkerPromptLogger } from './WorkerPromptLogger.js';
const { logWorkerPrompt } = WorkerPromptLogger;
import { WorkerPullRequest } from './WorkerPullRequest.js';
const { readWorkerMetadata, verifyWorkerPullRequest, persistWorkerPullRequest } = WorkerPullRequest;
import { RemoteManifestPublisher } from './RemoteManifestPublisher.js';
const { publishCurrentRemoteManifest } = RemoteManifestPublisher;
import { WorkerBranch } from './WorkerBranch.js';
const { workerBranchName } = WorkerBranch;

async function runWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
): Promise<number> {
  validateWorkerConfiguration(cfg);
  await validateRecoverableWorkerPr(d, pr);

  const { runId, logger } = startWorkerRun(cfg, d, issue, round, pr);
  const invocation = createWorkerInvocation(cfg, d, issue, round, pr, context, feedback, runId);
  logWorkerPrompt(logger, feedback);
  const output = await runRoleLogged(
    d,
    logger,
    'worker',
    issue,
    runId,
    invocation.spec,
    invocation.progress,
    context,
    feedback,
    invocation.prompt,
  );
  logger.write('result', { role: 'worker', output: allowlistedPublication(output) });

  const metadata = readWorkerMetadata(output, pr, cfg);
  const workerPr = metadata.pr;
  const expectedBranch = d.load().branch ?? workerBranchName(issue.number);
  d.save({ ...d.load(), pr: workerPr, workerPid: undefined, workerHeartbeatAt: d.now() });
  publishCurrentRemoteManifest(cfg, d, issue.number, 'review');

  const evidence = await verifyWorkerPullRequest(cfg, d, issue, round, workerPr, expectedBranch);
  persistWorkerPullRequest(d, issue, workerPr, evidence);

  return workerPr;
}

export const WorkerExecution = { runWorker };
