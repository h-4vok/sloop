import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import type { GitHubProvider } from '../../core/boundaries.js';
import type { Issue, PullRequest } from '../../dispatcher.js';
import { selectIssues } from '../../dispatcher.js';
import { issueLabelNames } from '../../issue-selection.js';
import { publicationBody } from '../../publication.js';
import type { AdapterExec } from './AdapterExec.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;

type GitHubProviderOptions = Readonly<{
  root: string;
  repository: string;
  eligibleLabel: string;
  priorityLabels: readonly string[];
  execute: AdapterExec;
  logGithub: (phase: string, operation: string, data: unknown) => void;
}>;

type ProductionGitHubProvider = GitHubProvider<Issue, PullRequest> &
  Readonly<{
    list: () => readonly { number: number; title: string }[];
    pullRequest: (pullRequestNumber: number) => PullRequest;
  }>;

function loadIssues(client: GitHubCommandClient, label: string): Issue[] {
  const issues = client.runJson<
    (Omit<Issue, 'labels'> & { labels?: readonly (string | { name?: string })[] })[]
  >([
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    label,
    '--json',
    'number,title,body,labels',
    '--limit',
    '100',
  ]);

  return issues.map((issue) => ({ ...issue, labels: issueLabelNames(issue.labels) }));
}

function loadPullRequest(client: GitHubCommandClient, pullRequestNumber: number): PullRequest {
  const raw = client.runJson<any>([
    'pr',
    'view',
    String(pullRequestNumber),
    '--json',
    'number,state,baseRefName,baseRefOid,headRefName,headRefOid,body,mergeStateStatus,mergeable,reviews,comments,statusCheckRollup',
  ]);

  return {
    number: raw.number,
    state: raw.state,
    baseRefOid: raw.baseRefOid,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    body: raw.body ?? '',
    mergeStateStatus: raw.mergeStateStatus ?? raw.merge_state_status,
    mergeable: raw.mergeable,
    reviews: (raw.reviews ?? []).map((review: any) => ({
      body: review.body,
      state: review.state,
      submittedAt: review.submittedAt ?? review.submitted_at,
      commitId: review.commit?.oid ?? review.commitId ?? review.commit_id,
    })),
    comments: (raw.comments ?? []).map((comment: any) => ({
      body: comment.body,
      createdAt: comment.createdAt ?? comment.created_at,
    })),
    statusCheckRollup: (raw.statusCheckRollup ?? []).map((check: any) => ({
      name: check.name ?? check.context ?? check.workflowName ?? '',
      status: check.status ?? check.state,
      conclusion: check.conclusion ?? check.state,
      detailsUrl: check.detailsUrl ?? check.details_url,
    })),
  };
}

function publishBody(client: GitHubCommandClient, args: readonly string[], body: unknown): void {
  client.run([...args, '--body', publicationBody(body)], { stdio: 'inherit' });
}

function publishPullRequestBody(
  client: GitHubCommandClient,
  root: string,
  pullRequestNumber: number,
  body: unknown,
): void {
  const temporaryBodyFile = join(root, `.sloop-pr-${process.pid}-${Date.now()}.md`);

  try {
    writeFileSync(temporaryBodyFile, publicationBody(body), 'utf8');
    client.run(['pr', 'edit', String(pullRequestNumber), '--body-file', temporaryBodyFile], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(temporaryBodyFile, { force: true });
  }
}

function findIssueByIdempotencyKey(client: GitHubCommandClient, body: string): number | undefined {
  const idempotencyKey = body.match(/Idempotency key:\s*(\S+)/)?.[1];
  if (!idempotencyKey) return undefined;

  const existingIssues = client.runJson<{ number?: number; body?: string }[]>([
    'issue',
    'list',
    '--state',
    'all',
    '--search',
    idempotencyKey,
    '--json',
    'number,body',
    '--limit',
    '100',
  ]);
  return existingIssues.find((issue) => issue.body?.includes(idempotencyKey))?.number;
}

function createIssueNumber(client: GitHubCommandClient, title: string, body: string): number {
  const rawIssueUrl = client
    .run(['issue', 'create', '--title', title, '--body', publicationBody(body)], {
      stdio: 'pipe',
    })
    .trim();
  const issueMatch = rawIssueUrl.match(/\/issues\/(\d+)(?:\D|$)/);
  if (!issueMatch) throw new Error(`gh issue create returned no issue number: ${rawIssueUrl}`);
  return Number(issueMatch[1]);
}

function createIssue(
  client: GitHubCommandClient,
  title: string,
  body: string,
  logGithub: GitHubProviderOptions['logGithub'],
): number {
  logGithub('request', 'issue.create', { title, body });

  try {
    const existingIssue = findIssueByIdempotencyKey(client, body);
    if (existingIssue) return existingIssue;

    const issueNumber = createIssueNumber(client, title, body);
    logGithub('response', 'issue.create', { issue: issueNumber });
    return issueNumber;
  } catch (error) {
    logGithub('error', 'issue.create', error instanceof Error ? error.message : String(error));
    throw error instanceof ExternalServiceError
      ? error
      : new ExternalServiceError('github', error instanceof Error ? error.message : String(error));
  }
}

function createEligibleIssuesHandler(
  options: GitHubProviderOptions,
  loadEligibleIssues: () => Issue[],
) {
  return () => {
    try {
      const issues = selectIssues(loadEligibleIssues(), options.priorityLabels);
      options.logGithub('response', 'eligible', issues);

      return issues;
    } catch (error) {
      options.logGithub(
        'error',
        'eligible',
        error instanceof Error ? error.message : String(error),
      );
      throw error instanceof ExternalServiceError
        ? error
        : new ExternalServiceError(
            'github',
            error instanceof Error ? error.message : String(error),
          );
    }
  };
}

function createIssueCommentHandler(options: GitHubProviderOptions, client: GitHubCommandClient) {
  return (issue: number, body: string) => {
    try {
      options.logGithub('request', 'issue.comment', { issue, body });
      publishBody(client, ['issue', 'comment', String(issue)], body);
      options.logGithub('response', 'issue.comment', { issue });
    } catch (error) {
      options.logGithub(
        'error',
        'issue.comment',
        error instanceof Error ? error.message : String(error),
      );
      throw error instanceof ExternalServiceError
        ? error
        : new ExternalServiceError(
            'github',
            error instanceof Error ? error.message : String(error),
          );
    }
  };
}

function createPullRequestHandler(options: GitHubProviderOptions, client: GitHubCommandClient) {
  return (pullRequestNumber: number) => {
    options.logGithub('request', 'pullRequest', { pr: pullRequestNumber });

    try {
      const pullRequest = loadPullRequest(client, pullRequestNumber);
      options.logGithub('response', 'pullRequest', pullRequest);

      return pullRequest;
    } catch (error) {
      options.logGithub(
        'error',
        'pullRequest',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
}

function createPullRequestBodyUpdater(options: GitHubProviderOptions, client: GitHubCommandClient) {
  return (pullRequestNumber: number, body: unknown) => {
    options.logGithub('request', 'updatePullRequestBody', { pr: pullRequestNumber, body });

    try {
      publishPullRequestBody(client, options.root, pullRequestNumber, body);
      options.logGithub('response', 'updatePullRequestBody', { pr: pullRequestNumber });
    } catch (error) {
      options.logGithub(
        'error',
        'updatePullRequestBody',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
}

function createPullRequestBodyReader(options: GitHubProviderOptions, client: GitHubCommandClient) {
  return (pullRequestNumber: number) => {
    options.logGithub('request', 'pullRequestBody', { pr: pullRequestNumber });

    try {
      const response = client.runJson<{ body?: string }>([
        'pr',
        'view',
        String(pullRequestNumber),
        '--json',
        'body',
      ]);
      const body = response.body ?? '';
      options.logGithub('response', 'pullRequestBody', body);

      return body;
    } catch (error) {
      options.logGithub(
        'error',
        'pullRequestBody',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
}

function createPullRequestCommentHandler(
  options: GitHubProviderOptions,
  client: GitHubCommandClient,
) {
  return (pullRequestNumber: number, body: string) => {
    options.logGithub('request', 'prComment', { pr: pullRequestNumber, body });

    try {
      publishBody(client, ['pr', 'comment', String(pullRequestNumber)], body);
      options.logGithub('response', 'prComment', { pr: pullRequestNumber });
    } catch (error) {
      options.logGithub(
        'error',
        'prComment',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
}

function createIssueListHandler(options: GitHubProviderOptions, loadEligibleIssues: () => Issue[]) {
  return () => {
    try {
      return selectIssues(loadEligibleIssues(), options.priorityLabels).map(
        ({ number, title }) => ({
          number,
          title,
        }),
      );
    } catch (error) {
      throw error instanceof ExternalServiceError
        ? error
        : new ExternalServiceError(
            'github',
            error instanceof Error ? error.message : String(error),
          );
    }
  };
}

/** Creates the production GitHub provider used by dispatcher dependency assembly. */
export const gitHubProviderFactory = Object.freeze({
  create(options: GitHubProviderOptions): ProductionGitHubProvider {
    const client = gitHubCommandClientFactory.create(
      options.root,
      options.repository,
      options.execute,
    );
    const loadEligibleIssues = () => loadIssues(client, options.eligibleLabel);
    const loadEligibleIssuesWithPriority = createEligibleIssuesHandler(options, loadEligibleIssues);
    const commentOnIssue = createIssueCommentHandler(options, client);
    const loadPullRequestForDispatcher = createPullRequestHandler(options, client);
    const updatePullRequestBodyForDispatcher = createPullRequestBodyUpdater(options, client);
    const loadPullRequestBody = createPullRequestBodyReader(options, client);
    const commentOnPullRequest = createPullRequestCommentHandler(options, client);
    const listEligibleIssues = createIssueListHandler(options, loadEligibleIssues);

    return {
      eligible: loadEligibleIssuesWithPriority,
      createIssue: (title, body) => createIssue(client, title, body, options.logGithub),
      comment: commentOnIssue,
      pullRequest: loadPullRequestForDispatcher,
      updatePullRequestBody: updatePullRequestBodyForDispatcher,
      pullRequestBody: loadPullRequestBody,
      prComment: commentOnPullRequest,
      list: listEligibleIssues,
    };
  },
});
