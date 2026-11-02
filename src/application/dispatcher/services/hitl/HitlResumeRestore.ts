/** Coordinates hitl resume restore operations for dispatcher workflows. */
import type { Config, Deps } from '../../types/index.js';
import type { RemoteSnapshot, RunManifest } from '../../../../remote-state.js';
import { HitlResumeDirectiveService } from './HitlResumeDirectiveService.js';
const { hitlResumeDirective } = HitlResumeDirectiveService;
import { createRestoredRunManifest } from './createRestoredRunManifest.js';
import { HitlResumeHistory } from '../HitlResumeHistory.js';
const { previousManifest } = HitlResumeHistory;
import { HitlResumeState } from '../HitlResumeState.js';
const { reviewCap } = HitlResumeState;

function canRestoreHitlResume(
  current: ReturnType<Deps['load']>,
  issue: number,
  snapshot: RemoteSnapshot,
): boolean {
  return (
    isRecoveryPending(current) &&
    current.issue === issue &&
    hasRestorablePullRequest(current, snapshot)
  );
}

function isRecoveryPending(current: ReturnType<Deps['load']>): boolean {
  return current.status === 'worker_recovery_pending';
}

function hasRestorablePullRequest(
  current: ReturnType<Deps['load']>,
  snapshot: RemoteSnapshot,
): boolean {
  if (!current.pr) return false;
  if (snapshot.pr !== current.pr) return false;
  if (snapshot.prState?.toUpperCase() !== 'OPEN') return false;

  return Boolean(snapshot.branch);
}

function restoreHitlResume(
  cfg: Config,
  d: Deps,
  issue: number,
  snapshot: RemoteSnapshot,
  manifest: RunManifest | undefined,
): RunManifest | undefined {
  const current = d.load();
  if (!d.remote || !canRestoreHitlResume(current, issue, snapshot)) return undefined;
  const directive = selectRestorableHitlDirective(current, snapshot, issue, manifest);
  if (!directive) return undefined;
  const previous = previousManifest(
    snapshot,
    issue,
    current.pr!,
    snapshot.branch!,
    directive.round,
    manifest,
  );
  if (!previous) return undefined;

  return persistRestoredHitlResume(cfg, d, d.remote, current, issue, snapshot, directive, previous);
}

function selectRestorableHitlDirective(
  current: ReturnType<Deps['load']>,
  snapshot: RemoteSnapshot,
  issue: number,
  manifest: RunManifest | undefined,
) {
  const directive = hitlResumeDirective(snapshot, issue, current.pr!);
  if (!directive || directive.round < (current.reviewRound ?? 1)) return undefined;
  if (isHitlResumeAlreadyRestored(current, snapshot, directive, manifest)) return undefined;

  return directive;
}

function isHitlResumeAlreadyRestored(
  current: ReturnType<Deps['load']>,
  snapshot: RemoteSnapshot,
  directive: NonNullable<ReturnType<typeof hitlResumeDirective>>,
  manifest: RunManifest | undefined,
): boolean {
  return Boolean(
    manifest &&
    manifest.phase !== 'complete' &&
    manifest.reviewRound >= directive.round &&
    manifest.branch === snapshot.branch &&
    current.branch === snapshot.branch,
  );
}

function persistRestoredHitlResume(
  cfg: Config,
  d: Deps,
  remote: NonNullable<Deps['remote']>,
  current: ReturnType<Deps['load']>,
  issue: number,
  snapshot: RemoteSnapshot,
  directive: NonNullable<ReturnType<typeof hitlResumeDirective>>,
  previous: RunManifest,
): RunManifest {
  const branch = snapshot.branch!;
  const restoredReviewCap = createRestoredReviewCap(cfg, current, snapshot, directive);
  d.save({
    ...current,

    issue,

    pr: current.pr,

    branch,

    headSha: snapshot.sha,

    workerRunId: previous.runId,

    reviewRound: directive.round,

    reviewCap: restoredReviewCap,

    status: 'worker_recovery_pending',

    lastError: undefined,

    lastErrorVerbose: undefined,

    updatedAt: d.now(),
  });
  const restored = createRestoredRunManifest(cfg, d, current, issue, branch, directive, previous);
  remote.publish(issue, restored);
  return restored;
}

function createRestoredReviewCap(
  cfg: Config,
  current: ReturnType<Deps['load']>,
  snapshot: RemoteSnapshot,
  directive: NonNullable<ReturnType<typeof hitlResumeDirective>>,
) {
  return reviewCap(current, snapshot, directive, cfg.maxReviewRounds ?? 10);
}

export const HitlResumeRestore = {
  restoreHitlResume,
};
