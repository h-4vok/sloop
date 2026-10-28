/** Coordinates issue link operations for dispatcher workflows. */
import type { DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { RunStateStore } from './RunStateStore.js';
const { stateFile, readState, writeState } = RunStateStore;
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
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

function linkIssueToActiveRun(
  issue: number,
  statePath = stateFile,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  if (!Number.isInteger(issue) || issue <= 0)
    throw new Error('--link-issue requires a positive issue number');
  const current = readState(statePath);
  if (!current.issue || !current.pr)
    throw new Error('--link-issue requires one active run with an existing PR');
  gh(['issue', 'view', String(issue), '--json', 'number,state'], cwd, repository, host);
  const linkedClosingIssues = [...new Set([...(current.linkedClosingIssues ?? []), issue])].filter(
    (number) => number !== current.issue,
  );
  const next = { ...current, linkedClosingIssues, updatedAt: Date.now() };
  writeState(next, statePath);
  const body = pullRequestBody(current.pr, cwd, repository, host);
  const normalized = withIssueClosingReference(body, current.issue, linkedClosingIssues);
  if (normalized !== body.trim())
    updatePullRequestBody(current.pr, normalized, cwd, repository, host);
  const note = `[Sloop linked issue] PR #${current.pr} closes #${current.issue} and #${issue} when a human merges to main.`;
  commentIssueOnce(current.issue, note, cwd, repository, host);
  commentIssueOnce(issue, note, cwd, repository, host);
  commentPullRequestOnce(current.pr, note, cwd, repository, host);
}

export const IssueLink = {
  linkIssueToActiveRun,
};
