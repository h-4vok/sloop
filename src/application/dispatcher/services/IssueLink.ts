/** Coordinates issue link operations for dispatcher workflows. */
import type { DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot, runStateStore } = DispatcherRuntime;
const { stateFile, readState, writeState } = runStateStore;
import { GitHubCli } from './GitHubCli.js';
const { gh } = GitHubCli;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequestBody } = PullRequestReader;
import { PullRequestPublisher } from './PullRequestPublisher.js';
const {
  withIssueClosingReference,
  updatePullRequestBody,
  commentIssueOnce,
  commentPullRequestOnce,
} = PullRequestPublisher;

function validateIssueNumber(issue: number): void {
  if (!Number.isInteger(issue) || issue <= 0)
    throw new Error('--link-issue requires a positive issue number');
}

function validateActiveIssueLink(
  current: ReturnType<typeof readState>,
): asserts current is ReturnType<typeof readState> & { issue: number; pr: number } {
  if (!current.issue || !current.pr)
    throw new Error('--link-issue requires one active run with an existing PR');
}

function saveLinkedIssues(
  current: ReturnType<typeof readState>,
  linkedClosingIssues: number[],
  statePath: string,
): void {
  const saveResult = writeState(
    { ...current, linkedClosingIssues, updatedAt: Date.now() },
    statePath,
  );
  if (!saveResult.ok) throw saveResult.error;
}

function synchronizePullRequestLinks(
  current: ReturnType<typeof readState>,
  linkedClosingIssues: number[],
  cwd: string,
  repository?: string,
  host?: DispatcherHost,
): void {
  const body = pullRequestBody(current.pr!, cwd, repository, host);
  const normalized = withIssueClosingReference(body, current.issue!, linkedClosingIssues);
  if (normalized !== body.trim())
    updatePullRequestBody(current.pr!, normalized, cwd, repository, host);
}

function linkIssueToActiveRun(
  issue: number,
  statePath = stateFile,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  validateIssueNumber(issue);
  const current = readState(statePath);
  validateActiveIssueLink(current);
  gh(['issue', 'view', String(issue), '--json', 'number,state'], cwd, repository, host);
  const linkedClosingIssues = [...new Set([...(current.linkedClosingIssues ?? []), issue])].filter(
    (number) => number !== current.issue,
  );
  saveLinkedIssues(current, linkedClosingIssues, statePath);
  synchronizePullRequestLinks(current, linkedClosingIssues, cwd, repository, host);
  const note = `[Sloop linked issue] PR #${current.pr} closes #${current.issue} and #${issue} when a human merges to main.`;
  commentIssueOnce(current.issue, note, cwd, repository, host);
  commentIssueOnce(issue, note, cwd, repository, host);
  commentPullRequestOnce(current.pr, note, cwd, repository, host);
}

export const IssueLink = {
  linkIssueToActiveRun,
};
