import type { Config, DispatcherHost, State } from '../../types/index.js';
import type { RemoteAuthority, ReviewCapOptions } from '../../../../core/boundaries.js';
import type { ReviewCapResumeContext } from '../../types/ReviewCapResumeContext.js';
import { PullRequestReader } from '../PullRequestReader.js';
const { pullRequest } = PullRequestReader;
import { ReviewCapPolicy } from '../ReviewCapPolicy.js';
const { prHealthyForHumanMerge } = ReviewCapPolicy;
import { ReviewCapStateBuilder } from '../ReviewCapStateBuilder.js';
const { buildReviewCapState: buildReviewCapDecision } = ReviewCapStateBuilder;

function normalizeFindingWaivers(
  options: Pick<ReviewCapOptions, 'waiveAllOutstanding' | 'waivedFindingIds'>,
  outstanding: ReadonlySet<string>,
): string[] {
  const requested = options.waivedFindingIds.map((id) => id.toUpperCase());
  const normalized = options.waiveAllOutstanding ? [...outstanding] : [...new Set(requested)];
  if (normalized.some((id) => !outstanding.has(id)))
    throw new Error(
      `waivers must name outstanding findings: ${[...outstanding].join(', ') || 'none'}`,
    );

  return normalized;
}

function buildReviewCapState(
  options: ReviewCapOptions,
  cfg: Config,
  context: ReviewCapResumeContext,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
): State {
  const { current, remoteSnapshot } = context;
  const reviewCap = current.reviewCap ?? createDefaultReviewCap(current);
  const normalizedWaivers = normalizeFindingWaivers(
    options,
    new Set(reviewCap.outstandingFindingIds),
  );
  const cap = buildReviewCapDecision(
    current,
    reviewCap,
    options,
    normalizedWaivers,
    cfg,
    cwd,
    repository,
    host,
  );
  validateReviewCapWaiver(options, cap.outstandingFindingIds, cap.waivedFindingIds);
  validateReviewCapPullRequest(cfg, options, context, cwd, repository, host);
  const status = reviewCapResumeStatus(options.additionalRounds);
  const workerPid = reviewCapWorkerPid(options.additionalRounds, current.workerPid);

  return {
    ...current,

    reviewCap: cap,

    status,

    workerPid,

    lastError: undefined,

    lastErrorVerbose: undefined,

    updatedAt: Date.now(),
  };
}

function reviewCapResumeStatus(additionalRounds: number): State['status'] {
  return additionalRounds > 0 ? 'worker_recovery_pending' : 'ready_for_human_merge';
}

function reviewCapWorkerPid(additionalRounds: number, workerPid: number | undefined) {
  return additionalRounds > 0 ? undefined : workerPid;
}

function createDefaultReviewCap(current: State): NonNullable<State['reviewCap']> {
  return {
    capRound: current.reviewRound ?? 1,

    outstandingFindingIds: [],

    additionalRounds: 0,

    waivedFindingIds: [],
  };
}

function validateReviewCapWaiver(
  options: ReviewCapOptions,
  outstandingFindingIds: readonly string[],
  waivedFindingIds: readonly string[],
): void {
  const allWaived = outstandingFindingIds.every((id) => waivedFindingIds.includes(id));
  if (options.additionalRounds === 0 && !allWaived)
    throw new Error('findings remain; waive them explicitly or grant additional rounds');
}

function validateReviewCapPullRequest(
  cfg: Config,
  options: Pick<ReviewCapOptions, 'additionalRounds'>,
  context: ReviewCapResumeContext,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
): void {
  const pr = pullRequest(context.current.pr!, cwd, repository, host);
  if (context.remoteSnapshot && pr.headRefName !== context.remoteSnapshot.branch)
    throw new Error('review-cap resume PR head changed while reconciling remote state');
  requireHealthyReviewCapPullRequest(cfg, options.additionalRounds, pr);
}

function requireHealthyReviewCapPullRequest(
  cfg: Config,
  additionalRounds: number,
  pr: ReturnType<typeof pullRequest>,
): void {
  if (additionalRounds === 0 && !prHealthyForHumanMerge(pr, cfg))
    throw new Error(
      'PR must have green required checks and be clean/mergeable before a no-round waiver',
    );
}

export const ReviewCapResumeState = { buildReviewCapState };
