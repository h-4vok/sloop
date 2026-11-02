import type { Config, Deps, DispatcherHost, State } from '../types/index.js';
import type { RemoteAuthority } from '../../../core/boundaries.js';
import type { RunManifest } from '../../../remote-state.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { runStateStore } = DispatcherRuntime;
const { writeState } = runStateStore;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequest } = PullRequestReader;
import { ReviewCapPolicy } from './ReviewCapPolicy.js';
const { prHealthyForHumanMerge } = ReviewCapPolicy;
import { HitlDecisionPublisher } from './HitlDecisionPublisher.js';
const { publishHitlDecision } = HitlDecisionPublisher;
import type { ReviewCapResumeContext } from '../types/ReviewCapResumeContext.js';
import { ReviewCapReconciliation } from './ReviewCapReconciliation.js';
const { reconcileReviewCapResume } = ReviewCapReconciliation;
import { ReviewCapStateBuilder } from './ReviewCapStateBuilder.js';
const { buildReviewCapState: buildReviewCapDecision } = ReviewCapStateBuilder;

function normalizeFindingWaivers(
  options: { waiveAllOutstanding: boolean; waivedFindingIds: readonly string[] },
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
  options: {
    steer: string;
    waiveAllOutstanding: boolean;
    waivedFindingIds: readonly string[];
    additionalRounds: number;
  },
  cfg: Config,
  context: ReviewCapResumeContext,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
): State {
  const { current, remoteSnapshot } = context;
  const reviewCap = current.reviewCap ?? {
    capRound: current.reviewRound ?? 1,

    outstandingFindingIds: [],

    additionalRounds: 0,

    waivedFindingIds: [],
  };
  const outstanding = new Set(reviewCap.outstandingFindingIds);
  const normalizedWaivers = normalizeFindingWaivers(options, outstanding);
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
  const allWaived = cap.outstandingFindingIds.every((id) => cap.waivedFindingIds.includes(id));
  if (options.additionalRounds === 0 && !allWaived)
    throw new Error('findings remain; waive them explicitly or grant additional rounds');
  validateReviewCapPullRequest(cfg, options, context, cwd, repository, host);

  return {
    ...current,

    reviewCap: cap,

    status: options.additionalRounds > 0 ? 'worker_recovery_pending' : 'ready_for_human_merge',

    workerPid: options.additionalRounds > 0 ? undefined : current.workerPid,

    lastError: undefined,

    lastErrorVerbose: undefined,

    updatedAt: Date.now(),
  };
}

function validateReviewCapPullRequest(
  cfg: Config,
  options: { additionalRounds: number },
  context: ReviewCapResumeContext,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
): void {
  const pr = pullRequest(context.current.pr!, cwd, repository, host);
  if (context.remoteSnapshot && pr.headRefName !== context.remoteSnapshot.branch)
    throw new Error('review-cap resume PR head changed while reconciling remote state');
  if (options.additionalRounds === 0 && !prHealthyForHumanMerge(pr, cfg))
    throw new Error(
      'PR must have green required checks and be clean/mergeable before a no-round waiver',
    );
}

function persistReviewCapDecision(
  next: State,
  context: ReviewCapResumeContext,
  options: { additionalRounds: number },
  statePath: string,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
  remote?: RemoteAuthority,
): void {
  const saveResult = writeState(next, statePath);
  if (!saveResult.ok) throw saveResult.error;
  publishHitlDecision(
    next,
    options.additionalRounds > 0 ? 'resume' : 'waive_ready_for_human_merge',
    cwd,
    repository,
    host,
  );
  if (remote && context.remoteManifest) {
    remote.publish(context.current.issue!, {
      ...context.remoteManifest,

      pr: context.current.pr,

      branch: context.current.branch!,

      phase: 'blocked',

      lease: undefined,

      reviewRound: context.current.reviewRound ?? context.remoteManifest.reviewRound ?? 1,
    });
  }
}

export const ReviewCapResume = {
  reconcileReviewCapResume,

  buildReviewCapState,

  persistReviewCapDecision,
};
