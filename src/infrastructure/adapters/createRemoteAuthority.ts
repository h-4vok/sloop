import type { RemoteAuthority } from '../../core/boundaries.js';
import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import { artifactKey, parseRunManifestMarker, runManifestMarker } from '../../remote-state.js';
import type { RemoteSnapshot, RunManifest } from '../../remote-state.js';
import type { gitHubCommandClientFactory } from './createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;
type GitHubEventLogger = (phase: string, operation: string, data: unknown) => void;

type IssueSnapshot = Readonly<{
  state?: string;
  labels?: readonly { name: string }[];
  comments?: readonly { body: string; createdAt?: string; id?: number }[];
}>;

type PullRequestSnapshot = Readonly<{
  number?: number;
  state?: string;
  mergedAt?: string;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  comments?: readonly { body: string; createdAt?: string; id?: number }[];
  reviews?: readonly { state: string }[];
  statusCheckRollup?: readonly { name: string; status: string; conclusion?: string }[];
}>;

type PullRequestDetails = Readonly<{
  pullRequest: PullRequestSnapshot;
  inlineThreads: readonly { resolved: boolean }[];
}>;

function readIssueSnapshot(client: GitHubCommandClient, issue: number): IssueSnapshot {
  return client.runJson<IssueSnapshot>([
    'issue',
    'view',
    String(issue),
    '--json',
    'state,labels,comments',
  ]);
}

function readPullRequestDetails(
  client: GitHubCommandClient,
  repository: string,
  pullRequestNumber: number,
): PullRequestDetails {
  const pullRequest = client.runJson<PullRequestSnapshot>([
    'pr',
    'view',
    String(pullRequestNumber),
    '--json',
    'number,state,mergedAt,baseRefName,headRefName,headRefOid,comments,reviews,statusCheckRollup',
  ]);
  const [owner, name] = repository.split('/', 2);
  if (!owner || !name) throw new Error('configured GitHub repository must be owner/name');

  const threadResponse = client.runJson<{
    data?: {
      repository?: {
        pullRequest?: { reviewThreads?: { nodes?: readonly { isResolved: boolean }[] } };
      };
    };
  }>([
    'api',
    'graphql',
    '-f',
    'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}',
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${pullRequestNumber}`,
  ]);
  const threadNodes = threadResponse.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

  return {
    pullRequest,

    inlineThreads: threadNodes.map((thread) => ({ resolved: thread.isResolved })),
  };
}

function extractManifests(comments: readonly { body: string }[], issue: number): RunManifest[] {
  return comments
    .map((comment) => parseRunManifestMarker(comment.body, issue))
    .filter((manifest): manifest is RunManifest => Boolean(manifest));
}

function extractMarkers(comments: readonly { body: string }[]): string[] {
  return comments.flatMap((comment) =>
    [...comment.body.matchAll(/(?:sloop\/v1\/[^\s`]+|sloop-v1\/[^\s`]+)/g)].map(
      (match) => match[0],
    ),
  );
}

function createRemoteSnapshot(
  client: GitHubCommandClient,
  repository: string,
  issue: number,
): RemoteSnapshot {
  const issueSnapshot = readIssueSnapshot(client, issue);
  const issueComments = issueSnapshot.comments ?? [];
  const issueManifests = extractManifests(issueComments, issue);
  const latestIssueManifest = issueManifests.at(-1);
  const pullRequestDetails = latestIssueManifest?.pr
    ? readPullRequestDetails(client, repository, latestIssueManifest.pr)
    : { pullRequest: {}, inlineThreads: [] };
  const pullRequest = pullRequestDetails.pullRequest;
  const comments = [...issueComments, ...(pullRequest.comments ?? [])];
  const latestManifest = extractManifests(comments, issue).at(-1) ?? latestIssueManifest;

  return {
    issue,

    issueState: issueSnapshot.state,

    labels: (issueSnapshot.labels ?? []).map((label) => label.name),

    pr: pullRequest.number ?? latestManifest?.pr,

    prState: pullRequest.state,

    prMergedAt: pullRequest.mergedAt,

    prBaseBranch: pullRequest.baseRefName,

    comments: comments.map((comment) => ({
      body: comment.body,

      ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),

      ...(comment.id ? { id: comment.id } : {}),
    })),

    markers: extractMarkers(comments),

    manifest: latestManifest,

    branch: pullRequest.headRefName ?? latestManifest?.branch,

    sha: pullRequest.headRefOid,

    checks: pullRequest.statusCheckRollup,

    reviews: pullRequest.reviews,

    inlineThreads: pullRequestDetails.inlineThreads,

    now: Date.now(),

    leaseOwner: `${process.pid}:${issue}`,
  };
}

function createClaimBody(issue: number, key: string, manifest: RunManifest | string): string {
  if (typeof manifest === 'string') return `sloop/v1/lease/${issue}/${key}/${manifest}`;

  return `${runManifestMarker({
    ...manifest,

    artifacts: [...new Set([...(manifest.artifacts ?? []), key])],
  })}\nsloop/v1/run/${manifest.runId}\n${key}\nsloop/v1/lease/${issue}/${manifest.lease?.owner ?? key}/${manifest.lease?.expiresAt ?? ''}`;
}

function publishRunBody(manifest: RunManifest, issue: number): string {
  const key = manifest.artifacts[0] ?? artifactKey('run', { issue, runId: manifest.runId });

  return `${runManifestMarker(manifest)}\nsloop/v1/run/${manifest.runId}\n${key}`;
}

function createSnapshotHandler(
  client: GitHubCommandClient,
  repository: string,
  logGithub: GitHubEventLogger,
) {
  return (issue: number) => {
    try {
      logGithub('request', 'remote.snapshot', { issue });
      const snapshot = createRemoteSnapshot(client, repository, issue);
      logGithub('response', 'remote.snapshot', snapshot);

      return snapshot;
    } catch (error) {
      logGithub('error', 'remote.snapshot', error instanceof Error ? error.message : String(error));
      throw new ExternalServiceError(
        'github',
        `GitHub snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}

function createReconcileHandler(client: GitHubCommandClient, logGithub: GitHubEventLogger) {
  return (issue: number, key: string) => {
    try {
      logGithub('request', 'remote.reconcile', { issue, key });
      const issueSnapshot = client.runJson<{ comments?: readonly { body: string }[] }>([
        'issue',
        'view',
        String(issue),
        '--json',
        'comments',
      ]);
      const isReconciled =
        issueSnapshot.comments?.some((comment) => comment.body.includes(key)) ?? false;
      logGithub('response', 'remote.reconcile', { issue, key, found: isReconciled });

      return isReconciled;
    } catch (error) {
      logGithub(
        'error',
        'remote.reconcile',
        error instanceof Error ? error.message : String(error),
      );
      throw new ExternalServiceError(
        'github',
        `GitHub reconciliation unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}

function createClaimHandler(client: GitHubCommandClient, logGithub: GitHubEventLogger) {
  return (issue: number, key: string, manifest: RunManifest) => {
    try {
      const body = createClaimBody(issue, key, manifest);
      logGithub('request', 'remote.claim', { issue, key, manifest });
      client.run(['issue', 'comment', String(issue), '--body', body], { stdio: 'inherit' });
      logGithub('response', 'remote.claim', { issue, key });
    } catch (error) {
      logGithub('error', 'remote.claim', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}

function createPublishHandler(client: GitHubCommandClient, logGithub: GitHubEventLogger) {
  return (issue: number, manifest: RunManifest) => {
    try {
      const body = publishRunBody(manifest, issue);
      const key = manifest.artifacts[0] ?? artifactKey('run', { issue, runId: manifest.runId });
      logGithub('request', 'remote.publish', { issue, key, manifest });
      client.run(['issue', 'comment', String(issue), '--body', body], { stdio: 'inherit' });
      logGithub('response', 'remote.publish', { issue, key });
    } catch (error) {
      logGithub('error', 'remote.publish', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}

/** Creates the GitHub-backed remote authority used by production dependency assembly. */
export const remoteAuthorityFactory = Object.freeze({
  create(
    client: GitHubCommandClient,
    repository: string,
    logGithub: GitHubEventLogger,
  ): RemoteAuthority {
    return {
      snapshot: createSnapshotHandler(client, repository, logGithub),

      reconcile: createReconcileHandler(client, logGithub),

      claim: createClaimHandler(client, logGithub),

      publish: createPublishHandler(client, logGithub),
    };
  },
});
