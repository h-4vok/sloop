import type { DispatcherHost, State } from '../types/index.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { runStateStore } = DispatcherRuntime;
const { writeState } = runStateStore;
import { GitHubCli } from './GitHubCli.js';
const { gh } = GitHubCli;
import { HitlDecisionPublisher } from './HitlDecisionPublisher.js';
const { publishHitlDecision } = HitlDecisionPublisher;

function validateAbandonment(state: State): void {
  if (
    !state.issue ||
    !state.pr ||
    !['review_cap_pending', 'abandon_pending'].includes(state.status ?? '')
  )
    throw new Error('abandonment requires the active review-cap run or its pending abandonment');
}

function saveAbandonmentStep(state: State, statePath: string): State {
  const saveResult = writeState(state, statePath);
  if (!saveResult.ok) throw saveResult.error;
  return state;
}

function completeAbandonment(state: State, statePath: string): void {
  const saveResult = writeState({ ...state, status: 'abandoned' }, statePath);
  if (!saveResult.ok) throw saveResult.error;
}

function abandonReviewCap(
  stored: State,
  steer: string,
  statePath: string,
  cwd: string,
  repository: string | undefined,
  host: DispatcherHost,
): void {
  validateAbandonment(stored);
  let state = saveAbandonmentStep(
    { ...stored, status: 'abandon_pending', abandonment: { ...stored.abandonment, steer } },
    statePath,
  );
  if (!state.abandonment?.commentPublished) {
    publishHitlDecision(state, 'abandon', cwd, repository, host);
    state = saveAbandonmentStep(
      { ...state, abandonment: { ...state.abandonment!, commentPublished: true } },
      statePath,
    );
  }
  if (!state.abandonment?.prClosed) {
    gh(['pr', 'close', String(state.pr)], cwd, repository, host);
    state = saveAbandonmentStep(
      { ...state, abandonment: { ...state.abandonment!, prClosed: true } },
      statePath,
    );
  }
  if (!state.abandonment?.labelled) {
    gh(['issue', 'edit', String(state.issue), '--add-label', 'wontfix'], cwd, repository, host);
    state = saveAbandonmentStep(
      { ...state, abandonment: { ...state.abandonment!, labelled: true } },
      statePath,
    );
  }
  if (!state.abandonment?.issueClosed) {
    gh(['issue', 'close', String(state.issue)], cwd, repository, host);
    state = saveAbandonmentStep(
      { ...state, abandonment: { ...state.abandonment!, issueClosed: true } },
      statePath,
    );
  }
  completeAbandonment(state, statePath);
}

export const ReviewCapAbandonment = { abandonReviewCap };
