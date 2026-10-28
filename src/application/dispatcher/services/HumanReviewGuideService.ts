/** Coordinates human review guide service operations for dispatcher workflows. */
import type { PullRequest, Deps } from '../../../application/dispatcher/types/index.js';
import type { HumanReviewGuide } from '../types/HumanReviewGuide.js';

const humanReviewGuideMarker = '<!-- sloop-dispatcher-human-review-guide -->';

function roundFromBody(body: string | undefined): number | undefined {
  const match = body?.match(/\bround=(\d+)\b/i);
  return match ? Number(match[1]) : undefined;
}

function hasCommit(body: string | undefined, headSha: string | undefined): boolean {
  if (!headSha) return true;
  // Some Windows callers pass escaped newlines (`\\n`) in comment bodies.
  // Do not let the delimiter become part of the commit token, or valid
  // Worker evidence will be rejected after the role has already exited.
  const match = body?.match(/\bcommit=([^\s\\]+)/i)?.[1];
  return Boolean(match && headSha.startsWith(match));
}

function latestWorkerComment(pr: PullRequest, round: number, headSha?: string) {
  return [...(pr.comments ?? [])]
    .filter(
      (comment) =>
        comment.body?.trim().startsWith('[Worker]') &&
        roundFromBody(comment.body) === round &&
        hasCommit(comment.body, headSha),
    )
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);
}

function humanReviewGuide(comment: { body?: string } | undefined): HumanReviewGuide | undefined {
  const match = comment?.body?.match(/\[Human Verification\]([\s\S]*)/i);
  const guide = match?.[1]?.trim();
  return guide || undefined;
}

function renderedHumanReviewGuide(guide: HumanReviewGuide, round: number, commit: string): string {
  return (
    `[Human Review Guide] round=${round} commit=${commit}\n${humanReviewGuideMarker}\n\n` + guide
  );
}

function isRenderedHumanReviewGuide(body: string | undefined, commit: string): boolean {
  if (!body?.trim().startsWith(`[Human Review Guide]`) || !body.includes(`commit=${commit}`))
    return false;
  return (
    body.includes(humanReviewGuideMarker) &&
    body.slice(body.indexOf(humanReviewGuideMarker) + humanReviewGuideMarker.length).trim().length >
      0
  );
}

function publishHumanReviewGuide(d: Deps, pr: PullRequest, round: number): void {
  const guide = humanReviewGuide(latestWorkerComment(pr, round, pr.headRefOid));
  if (!guide || !pr.headRefOid)
    throw new Error('Worker evidence must contain a complete [Human Verification] guide');
  const commit = pr.headRefOid;
  const currentGuides = (pr.comments ?? []).filter(
    (comment) =>
      comment.body?.trim().startsWith('[Human Review Guide]') &&
      comment.body?.match(/\bcommit=([^\s]+)/i)?.[1] === commit,
  );
  if (currentGuides.length > 1)
    throw new Error(
      `Expected exactly one [Human Review Guide] for commit ${commit}; found duplicates`,
    );
  if (currentGuides.length === 1) {
    if (isRenderedHumanReviewGuide(currentGuides[0].body, commit)) return;
    throw new Error(`Current [Human Review Guide] for commit ${commit} is not dispatcher-rendered`);
  }
  d.comment(pr.number, renderedHumanReviewGuide(guide, round, commit));
}

export const HumanReviewGuideService = {
  roundFromBody,
  hasCommit,
  latestWorkerComment,
  humanReviewGuide,
  renderedHumanReviewGuide,
  isRenderedHumanReviewGuide,
  publishHumanReviewGuide,
  humanReviewGuideMarker,
};
