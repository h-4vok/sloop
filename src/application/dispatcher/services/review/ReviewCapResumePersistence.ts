import type { DispatcherHost, State } from '../../types/index.js';
import type { RemoteAuthority } from '../../../../core/boundaries.js';
import type { RunManifest } from '../../../../remote-state.js';
import { DispatcherRuntime } from '../DispatcherRuntime.js';
const { runStateStore } = DispatcherRuntime;
const { writeState } = runStateStore;
import { HitlDecisionPublisher } from '../HitlDecisionPublisher.js';
const { publishHitlDecision } = HitlDecisionPublisher;
import type { ReviewCapResumeContext } from '../../types/ReviewCapResumeContext.js';

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
    reviewCapDecisionAction(options.additionalRounds),
    cwd,
    repository,
    host,
  );
  publishBlockedReviewCapManifest(context, remote);
}

function reviewCapDecisionAction(
  additionalRounds: number,
): 'resume' | 'waive_ready_for_human_merge' {
  return additionalRounds > 0 ? 'resume' : 'waive_ready_for_human_merge';
}

function publishBlockedReviewCapManifest(
  context: ReviewCapResumeContext,
  remote: RemoteAuthority | undefined,
): void {
  if (!remote || !context.remoteManifest) return;
  remote.publish(context.current.issue!, {
    ...context.remoteManifest,

    pr: context.current.pr,

    branch: context.current.branch!,

    phase: 'blocked',

    lease: undefined,

    reviewRound: context.current.reviewRound ?? context.remoteManifest.reviewRound ?? 1,
  } satisfies RunManifest);
}

export const ReviewCapResumePersistence = { persistReviewCapDecision };
