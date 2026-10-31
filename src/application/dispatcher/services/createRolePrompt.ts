import type { Issue } from '../../../application/dispatcher/types/index.js';

/** Builds the role-specific instruction for a dispatcher agent. */
export function createRolePrompt(
  issue: Issue,
  role: 'worker' | 'qa',
  pr: number | undefined,
  round: number,
  context: string,
  feedback: string,
  headSha: string | undefined,
  runId: string,
  initialPrBody?: string,
): string {
  const issueContext = issue.body?.trim() || '(issue body unavailable; inspect it with gh)';
  if (role === 'worker')
    return createWorkerPrompt(issue, pr, round, context, feedback, runId, issueContext);
  if (role === 'qa') return createQaPrompt(issue, pr, round, headSha, issueContext);

  return createStaffReviewPrompt(issue, pr, round, headSha, issueContext);
}

function createWorkerPrompt(
  issue: Issue,
  pr: number | undefined,
  round: number,
  context: string,
  feedback: string,
  runId: string,
  issueContext: string,
): string {
  const pullRequestInstruction = pr
    ? `An existing PR is #${pr}; update that PR and never create a second PR.`
    : 'Create exactly one PR targeting main if one does not exist.';
  const recoveredContext = context ? `Recovered context:\n${context}\n` : '';
  const actionableFeedback = feedback
    ? `Actionable feedback to resolve (the PR must be green before QA):\n${feedback}\n`
    : '';

  return `Use the worker skill for GitHub issue #${issue.number}: ${issue.title}. This is dispatcher recovery run ${runId}, review round ${round}. Continue the existing task in the current checkout. ${pullRequestInstruction} Do not merge. Inspect the issue, current PR diff, CI checks, and all [QA/SDET Review] feedback. Resolve every actionable finding and publish exactly one [Worker] evidence comment directly on the PR conversation using gh pr comment <PR number> --body-file <file>; do not post it only on the issue. The comment must include round=${round}, status=ready_for_review, pr=<number>, base=main, and commit=<current head SHA>. Follow the repository's own AGENTS.md, scripts, and workflow instructions for local verification. If CI feedback is supplied, resolve the reported failure in code when appropriate. Never modify dispatcher runtime state. Exit 0 only after the work, comment, and verification are complete. Issue body:\n${issueContext}\n${recoveredContext}${actionableFeedback}At the end, print WORKER_RESULT pr=<number> base=main.`;
}

function createQaPrompt(
  issue: Issue,
  pr: number | undefined,
  round: number,
  headSha: string | undefined,
  issueContext: string,
): string {
  return `Use the sloop-qa skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against main before Staff. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Inspect the acceptance criteria, diff, CI check results, regression coverage, and smoke evidence. Do not run interactive commands or commands that wait for a TTY; use non-interactive isolated checks only and treat interactive smoke procedures as documented evidence, not executable automation. Publish exactly one top-level PR comment using gh pr comment --body-file, beginning [QA/SDET Review] round=${round} verdict=passed, changes_requested, or blocked. Include Q<n> findings, exact evidence, and commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
}

function createStaffReviewPrompt(
  issue: Issue,
  pr: number | undefined,
  round: number,
  headSha: string | undefined,
  issueContext: string,
): string {
  return `Use the staff-reviewer skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against main after QA has passed. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Perform the independent adversarial review for design, security, regressions, boundaries, and abuse cases. Publish directly to the PR exactly one review beginning [Staff Review] round=${round} verdict=approved or changes_requested, include S<n> findings when needed, and include commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
}
