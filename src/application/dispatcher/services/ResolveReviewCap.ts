import type { Config, DispatcherHost } from '../types/index.js';
import type { RemoteAuthority } from '../types/RemoteAuthority.js';
import type { ReviewCapOptions } from '../types/ReviewCapOptions.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot, runStateStore, defaultProcessAlive } = DispatcherRuntime;
const { readState, stateFile } = runStateStore;
import { ReviewCapAbandonment } from './ReviewCapAbandonment.js';
const { abandonReviewCap } = ReviewCapAbandonment;
import { ReviewCapResume } from './review/ReviewCapResume.js';
const { reconcileReviewCapResume, buildReviewCapState, persistReviewCapDecision } = ReviewCapResume;

function hasConflictingAbandonmentOptions(options: ReviewCapOptions): boolean {
  return (
    options.abandon &&
    (options.waiveAllOutstanding ||
      options.waivedFindingIds.length > 0 ||
      Boolean(options.additionalRounds))
  );
}

function hasNoReviewCapAction(options: ReviewCapOptions): boolean {
  return (
    !options.abandon &&
    !options.waiveAllOutstanding &&
    options.waivedFindingIds.length === 0 &&
    options.additionalRounds === 0
  );
}

function validateReviewCapRequest(options: ReviewCapOptions): void {
  if (hasConflictingAbandonmentOptions(options))
    throw new Error('--abandon cannot be combined with waivers or additional rounds');
  if (hasNoReviewCapAction(options))
    throw new Error('choose --additional-rounds, --waive, --waive-all-outstanding, or --abandon');
}

function resolveReviewCap(
  options: ReviewCapOptions,
  cfg: Config,
  statePath = stateFile,
  cwd = defaultRoot,
  repository: string | undefined,
  host: DispatcherHost = {},
  remote?: RemoteAuthority,
): void {
  const stored = readState(statePath);
  validateReviewCapRequest(options);
  if (options.abandon) {
    abandonReviewCap(stored, options.steer.trim(), statePath, cwd, repository, host);
    return;
  }
  const context = reconcileReviewCapResume(stored, remote, defaultProcessAlive);
  const next = buildReviewCapState(options, cfg, context, cwd, repository, host);
  persistReviewCapDecision(next, context, options, statePath, cwd, repository, host, remote);
}

export const ResolveReviewCap = { resolveReviewCap };
