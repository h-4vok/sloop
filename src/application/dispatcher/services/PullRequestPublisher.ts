/** Coordinates pull request publisher operations for dispatcher workflows. */
import type { DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { publicationBody } from '../../../publication.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { GitHubCli } from './GitHubCli.js';
const { gh, ghJson } = GitHubCli;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequest } = PullRequestReader;

function updatePullRequestBody(
  pr: number,
  body: string,
  cwd = defaultRoot,
  repository?: string,
  host: DispatcherHost = {},
): void {
  const temp = join(
    tmpdir(),
    `sloop-pr-${host.pid?.() ?? process.pid}-${host.now?.() ?? Date.now()}.md`,
  );
  try {
    writeFileSync(temp, publicationBody(body), 'utf8');
    gh(['pr', 'edit', String(pr), '--body-file', temp], cwd, repository, host);
  } finally {
    rmSync(temp, { force: true });
  }
}

function commentPullRequest(
  pr: number,
  body: string,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  gh(['pr', 'comment', String(pr), '--body', publicationBody(body)], cwd, repository, host);
}

function commentIssueOnce(
  issue: number,
  body: string,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  const safeBody = publicationBody(body);
  const existing = ghJson<{ comments?: Array<{ body?: string }> }>(
    ['issue', 'view', String(issue), '--json', 'comments'],
    cwd,
    repository,
    host,
  );
  if (!existing.comments?.some((comment) => comment.body === safeBody))
    gh(['issue', 'comment', String(issue), '--body', safeBody], cwd, repository, host);
}

function commentPullRequestOnce(
  pr: number,
  body: string,
  cwd = defaultRoot,
  repository?: string,
  host?: DispatcherHost,
): void {
  if (
    !(pullRequest(pr, cwd, repository, host).comments ?? []).some(
      (comment) => comment.body === body,
    )
  )
    commentPullRequest(pr, body, cwd, repository, host);
}

function withIssueClosingReference(
  body: string | undefined,
  issue: number,
  linkedIssues: number[] = [],
): string {
  const issues = [...new Set([issue, ...linkedIssues])];
  if (issues.some((number) => !Number.isInteger(number) || number <= 0))
    throw new Error('issue number must be positive');
  const withoutClosingReferences = (body ?? '').replace(
    /^\s*(?:closes|close|closed)\s+#\d+\s*$/gim,
    '',
  );
  return `${withoutClosingReferences.trim()}${withoutClosingReferences.trim() ? '\n\n' : ''}${issues.map((number) => `Closes #${number}`).join('\n')}`;
}

export const PullRequestPublisher = {
  updatePullRequestBody,
  commentPullRequest,
  commentIssueOnce,
  commentPullRequestOnce,
  withIssueClosingReference,
};
