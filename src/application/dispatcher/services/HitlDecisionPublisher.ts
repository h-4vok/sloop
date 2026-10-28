/** Coordinates hitl decision publisher operations for dispatcher workflows. */
import type { State, DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { PullRequestPublisher } from './PullRequestPublisher.js';
const { commentIssueOnce, commentPullRequestOnce } = PullRequestPublisher;

function hitlComment(state: State, action: string): string {
  const cap = state.reviewCap!;
  return `[HITL Review Cap] action=${action} issue=#${state.issue} pr=#${state.pr} round=${state.reviewRound} sha=${cap.decisionSha ?? 'unknown'} waived=${cap.waivedFindingIds.join(',') || 'none'} additionalRounds=${cap.additionalRounds} steer=${cap.steer}`;
}

function publishHitlDecision(
  state: State,
  action: string,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  const body = hitlComment(state, action);
  commentIssueOnce(state.issue!, body, cwd, repository, host);
  commentPullRequestOnce(state.pr!, body, cwd, repository, host);
}

export const HitlDecisionPublisher = {
  hitlComment,
  publishHitlDecision,
};
