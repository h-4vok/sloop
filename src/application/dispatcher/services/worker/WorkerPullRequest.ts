import type { Config, Deps, Issue, PullRequest } from '../../types/index.js';
import { AgentRoles } from '../AgentRoles.js';
const { workerMetadata } = AgentRoles;
import { RunStatePolicy } from '../state/RunStatePolicy.js';
const { status } = RunStatePolicy;
import { WorkerBranch } from './WorkerBranch.js';
const { workerBranchName } = WorkerBranch;
import { RemoteManifestPublisher } from '../RemoteManifestPublisher.js';
const { publishCurrentRemoteManifest } = RemoteManifestPublisher;
import { ReviewEvidence } from '../review/ReviewEvidence.js';
const { waitForEvidence } = ReviewEvidence;
import { HumanReviewGuideService } from '../hitl/HumanReviewGuideService.js';
const { latestWorkerComment } = HumanReviewGuideService;
import { PullRequestPublisher } from '../PullRequestPublisher.js';
const { withIssueClosingReference } = PullRequestPublisher;

function readWorkerMetadata(
  output: string,
  pr: number | undefined,
  cfg: Config,
): ReturnType<typeof workerMetadata> & { pr: number } {
  const metadata = workerMetadata(output, pr);
  if (!metadata.pr || metadata.base !== (cfg.baseBranch ?? 'main'))
    throw new Error('Worker must report an existing PR based on main');

  return { ...metadata, pr: metadata.pr };
}

async function verifyWorkerPullRequest(
  cfg: Config,
  d: Deps,
  issue: Issue,
  round: number,
  pr: number,
  expectedBranch: string,
): Promise<PullRequest> {
  const evidence = await waitForWorkerEvidence(d, cfg, pr, round);
  validateWorkerPullRequest(evidence, cfg, pr, expectedBranch);
  await normalizeWorkerPullRequestBody(d, issue, pr, evidence);
  validateWorkerPullRequestMergeability(evidence, cfg, pr);

  return evidence;
}

async function waitForWorkerEvidence(
  d: Deps,
  cfg: Config,
  pr: number,
  round: number,
): Promise<PullRequest> {
  const evidence = await waitForEvidence(d, cfg, pr, (candidate) =>
    Boolean(latestWorkerComment(candidate, round, candidate.headRefOid)),
  );
  if (!latestWorkerComment(evidence, round, evidence.headRefOid))
    throw new Error(
      `Worker exited successfully but did not publish [Worker] evidence on PR #${pr}`,
    );

  return evidence;
}

function validateWorkerPullRequest(
  evidence: PullRequest,
  cfg: Config,
  pr: number,
  expectedBranch: string,
): void {
  const baseBranch = cfg.baseBranch ?? 'main';
  if (evidence.state?.toUpperCase() !== 'OPEN') throw new Error(`PR #${pr} must remain open`);
  if (evidence.baseRefName !== baseBranch) throw new Error(`PR #${pr} must target ${baseBranch}`);
  if (evidence.headRefName !== expectedBranch)
    throw new Error(
      `PR #${pr} must use worker branch ${expectedBranch}; found ${evidence.headRefName}`,
    );
}

function validateWorkerPullRequestMergeability(
  evidence: PullRequest,
  cfg: Config,
  pr: number,
): void {
  if (
    evidence.mergeable?.toUpperCase() === 'CONFLICTING' ||
    evidence.mergeStateStatus?.toUpperCase() === 'DIRTY'
  )
    throw new Error(`PR #${pr} remains conflicting or dirty against ${cfg.baseBranch ?? 'main'}`);
}

async function normalizeWorkerPullRequestBody(
  d: Deps,
  issue: Issue,
  pr: number,
  evidence: PullRequest,
): Promise<void> {
  const currentBody = evidence.body ?? (await d.pullRequestBody(pr));
  const normalizedBody = withIssueClosingReference(
    currentBody,
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  if (normalizedBody !== currentBody.trim()) await d.updatePullRequestBody(pr, normalizedBody);
}

function persistWorkerPullRequest(d: Deps, issue: Issue, pr: number, evidence: PullRequest): void {
  const state = d.load();
  const branch = state.branch ?? evidence.headRefName;
  d.save({
    ...state,

    pr,

    branch,

    headSha: evidence.headRefOid,

    workerPid: undefined,

    workerHeartbeatAt: d.now(),
  });
  status(d, issue.number, 'worker_ready_for_review', {
    pr,

    branch,

    headSha: evidence.headRefOid,
  });
}

export const WorkerPullRequest = {
  readWorkerMetadata,

  verifyWorkerPullRequest,

  persistWorkerPullRequest,
};
