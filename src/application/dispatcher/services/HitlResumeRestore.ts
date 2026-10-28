/** Coordinates hitl resume restore operations for dispatcher workflows. */
import type { Config, Deps } from '../../../application/dispatcher/types/index.js';
import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import { artifactKey } from '../../../remote-state.js';
import { HitlResumeDirectiveService } from './HitlResumeDirectiveService.js';
const { hitlResumeDirective } = HitlResumeDirectiveService;
import { RemoteRunState } from './RemoteRunState.js';
const { remoteManifest } = RemoteRunState;
import { HitlResumeHistory } from './HitlResumeHistory.js';
const { previousManifest } = HitlResumeHistory;
import { HitlResumeState } from './HitlResumeState.js';
const { reviewCap } = HitlResumeState;

function canRestoreHitlResume(
  current: ReturnType<Deps['load']>,
  issue: number,
  snapshot: RemoteSnapshot,
): boolean {
  return Boolean(
    current.status === 'worker_recovery_pending' &&
    current.issue === issue &&
    current.pr &&
    snapshot.pr === current.pr &&
    snapshot.prState?.toUpperCase() === 'OPEN' &&
    snapshot.branch,
  );
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
  const pr = current.pr!;
  const branch = snapshot.branch!;
  const directive = hitlResumeDirective(snapshot, issue, pr);
  if (!directive || directive.round < (current.reviewRound ?? 1)) return undefined;
  if (
    manifest &&
    manifest.phase !== 'complete' &&
    manifest.reviewRound >= directive.round &&
    manifest.branch === snapshot.branch &&
    current.branch === snapshot.branch
  )
    return undefined;

  const previous = previousManifest(snapshot, issue, pr, branch, directive.round, manifest);
  if (!previous) return undefined;
  const baseMaxRounds = cfg.maxReviewRounds ?? 10;
  const restoredReviewCap = reviewCap(current, snapshot, directive, baseMaxRounds);
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
  const key = previous.artifacts[0] ?? artifactKey('run', { issue, runId: previous.runId });
  const restored = remoteManifest(cfg, d, issue, previous.runId, key, 'blocked', undefined, {
    ...previous,
    pr: current.pr,
    branch,
    reviewRound: directive.round,
  });
  d.remote.publish(issue, restored);
  return restored;
}

export const HitlResumeRestore = {
  restoreHitlResume,
};
