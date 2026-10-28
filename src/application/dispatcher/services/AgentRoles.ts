/** Coordinates agent roles operations for dispatcher workflows. */
import type { Command, Spec, Issue, Config } from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';

function command(
  value: Command | undefined,
  _issue: number,
  _appendIssue = false,
): Spec | undefined {
  if (!value) return undefined;
  if (!Array.isArray(value) && (!value.command || /&&|\||;/.test(value.command)))
    throw new Error(
      'commands must be argv arrays or {command,args}; shell operators are not allowed',
    );
  if (!Array.isArray(value)) {
    if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string'))
      throw new Error(
        'commands must provide args as a string array; migrate each role command to { command, args, timeoutMs, retries }',
      );
  }
  return {
    command: Array.isArray(value) ? value[0] : value.command,
    args: Array.isArray(value) ? value.slice(1) : value.args,
    timeoutMs: Array.isArray(value) ? 120000 : (value.timeoutMs ?? 120000),
    retries: Array.isArray(value) ? 0 : (value.retries ?? 0),
    ...(!Array.isArray(value) && value.sessions === true ? { sessions: true } : {}),
    logInvocation: undefined,
  };
}

function rolePrompt(
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
    return `Use the worker skill for GitHub issue #${issue.number}: ${issue.title}. This is dispatcher recovery run ${runId}, review round ${round}. Continue the existing task in the current checkout. ${pr ? `An existing PR is #${pr}; update that PR and never create a second PR.` : 'Create exactly one PR targeting main if one does not exist.'} Do not merge. Inspect the issue, current PR diff, CI checks, and all [QA/SDET Review] feedback. Resolve every actionable finding and publish exactly one [Worker] evidence comment directly on the PR conversation using gh pr comment <PR number> --body-file <file>; do not post it only on the issue. The comment must include round=${round}, status=ready_for_review, pr=<number>, base=main, and commit=<current head SHA>. Follow the repository's own AGENTS.md, scripts, and workflow instructions for local verification. If CI feedback is supplied, resolve the reported failure in code when appropriate. Never modify dispatcher runtime state. Exit 0 only after the work, comment, and verification are complete. Issue body:\n${issueContext}\n${context ? `Recovered context:\n${context}\n` : ''}${feedback ? `Actionable feedback to resolve (the PR must be green before QA):\n${feedback}\n` : ''}At the end, print WORKER_RESULT pr=<number> base=main.`;
  if (role === 'qa')
    return `Use the sloop-qa skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against main before Staff. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Inspect the acceptance criteria, diff, CI check results, regression coverage, and smoke evidence. Do not run interactive commands or commands that wait for a TTY; use non-interactive isolated checks only and treat interactive smoke procedures as documented evidence, not executable automation. Publish exactly one top-level PR comment using gh pr comment --body-file, beginning [QA/SDET Review] round=${round} verdict=passed, changes_requested, or blocked. Include Q<n> findings, exact evidence, and commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
  return `Use the staff-reviewer skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against main after QA has passed. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Perform the independent adversarial review for design, security, regressions, boundaries, and abuse cases. Publish directly to the PR exactly one review beginning [Staff Review] round=${round} verdict=approved or changes_requested, include S<n> findings when needed, and include commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
}

function roleUpdate(role: 'worker' | 'qa', context: string, feedback: string): string {
  const label = role === 'worker' ? 'New worker task or recovery update' : 'New QA review update';
  return `${label}:\n${[context, feedback].filter(Boolean).join('\n\n') || '(no new update; inspect the current checkout and PR)'}`;
}

function appendWorkerRoundContext(
  root: string,
  issue: number,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
  steer: string | undefined,
): void {
  const directory = join(root, '.sloop', 'worker-rounds');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `issue-${issue}--worker-rounds.md`);
  const entry = [
    `# Dispatcher context for issue-${issue}-round-${round}`,
    '',
    `- Issue: #${issue}; round: ${round}; PR: ${pr ? `#${pr}` : 'none'}`,
    `- Prior work/context: ${context || '(none)'}`,
    `- HITL steer: ${steer || 'none supplied'}`,
    `- QA/Staff/CI feedback: ${feedback || '(none)'}`,
    '- Result: Worker execution started; completion evidence is in the run log.',
    '- Deviations: none recorded at dispatch time.',
    '',
  ].join('\n');
  appendFileSync(file, `${entry}\n`, 'utf8');
}

function roleCommand(value: Command | undefined, issue: number, cfg: Config): Spec | undefined {
  const spec = command(value, issue);
  if (!spec) return undefined;
  if (Array.isArray(value))
    throw new Error(
      'role commands must be { command, args, timeoutMs, retries }; migrate each role command from argv arrays',
    );
  if (/^(?:.*[\\/])?codex(?:\.cmd|\.exe)?$/i.test(spec.command) && spec.args[0] === 'exec') {
    const sandboxIndexes = spec.args.reduce<number[]>(
      (indexes, arg, index) => (arg === '--sandbox' ? [...indexes, index] : indexes),
      [],
    );
    if (
      sandboxIndexes.length !== 1 ||
      !['read-only', 'workspace-write', 'danger-full-access'].includes(
        spec.args[sandboxIndexes[0] + 1] ?? '',
      )
    )
      throw new Error(
        `${spec.command} exec must include exactly one valid --sandbox in args; migrate each role command and remove legacy codexSandbox`,
      );
  }
  return { ...spec, logInvocation: cfg.logRoleInvocation !== false };
}

function workerMetadata(output: string, knownPr?: number): { pr?: number; base?: string } {
  const match = output.match(/^\s*WORKER_RESULT\s+pr=(\d+)\s+base=([^\s]+)\s*$/im);
  if (match) return { pr: Number(match[1]), base: match[2] };
  if (knownPr) return { pr: knownPr, base: 'main' };
  // Codex can complete the PR and evidence steps, then omit the final marker.
  const summaryPr = output.match(/\bPR\s+(?:\[#?|#)(\d+)\]?/i);
  if (summaryPr) return { pr: Number(summaryPr[1]), base: 'main' };
  throw new Error('Worker must exit 0 and print WORKER_RESULT pr=<number> base=main');
}

export const AgentRoles = {
  command,
  rolePrompt,
  roleUpdate,
  appendWorkerRoundContext,
  roleCommand,
  workerMetadata,
};
