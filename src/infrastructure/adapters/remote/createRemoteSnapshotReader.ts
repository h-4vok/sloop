import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';
import {
  readRemotePullRequest,
  readRunManifests,
  type PullRequestSnapshot,
} from './readRemoteSnapshotDetails.js';
type Client = ReturnType<typeof gitHubCommandClientFactory.create>;
type IssueSnapshot = Readonly<{
  state?: string;
  labels?: readonly { name: string }[];
  comments?: readonly { body: string; createdAt?: string; id?: number }[];
}>;
/** Reads GitHub issue/PR state into the remote authority contract. */
export function createRemoteSnapshotReader(client: Client, repository: string) {
  return (issue: number): RemoteSnapshot => readRemoteSnapshot(client, repository, issue);
}

function readRemoteSnapshot(client: Client, repository: string, issue: number): RemoteSnapshot {
  const issueSnapshot = readIssueSnapshot(client, issue);
  const issueComments = issueSnapshot.comments ?? [];
  const issueManifest = readRunManifests(issueComments, issue).at(-1);
  const details = readManifestPullRequest(client, repository, issueManifest);
  const pullRequest = details.pullRequest;
  const comments = [...issueComments, ...(pullRequest.comments ?? [])];
  const manifest = readRunManifests(comments, issue).at(-1) ?? issueManifest;
  return createRemoteSnapshot(
    issueSnapshot,
    issue,
    comments,
    manifest,
    pullRequest,
    details.inlineThreads,
  );
}

function readIssueSnapshot(client: Client, issue: number): IssueSnapshot {
  return client.runJson<IssueSnapshot>([
    'issue',
    'view',
    String(issue),
    '--json',
    'state,labels,comments',
  ]);
}

function readManifestPullRequest(
  client: Client,
  repository: string,
  manifest: RunManifest | undefined,
) {
  if (manifest?.pr) return readRemotePullRequest(client, repository, manifest.pr);
  return { pullRequest: {} as PullRequestSnapshot, inlineThreads: [] };
}

function createRemoteSnapshot(
  issueSnapshot: IssueSnapshot,
  issue: number,
  comments: readonly { body: string; createdAt?: string; id?: number }[],
  manifest: RunManifest | undefined,
  pullRequest: PullRequestSnapshot,
  inlineThreads: { resolved: boolean }[],
): RemoteSnapshot {
  return {
    issue,
    issueState: issueSnapshot.state,
    labels: (issueSnapshot.labels ?? []).map(({ name }) => name),
    pr: firstDefined(pullRequest.number, manifest?.pr),
    prState: pullRequest.state,
    prMergedAt: pullRequest.mergedAt,
    prBaseBranch: pullRequest.baseRefName,
    comments: comments.map(mapRemoteComment),
    markers: findRemoteMarkers(comments),
    manifest,
    branch: firstDefined(pullRequest.headRefName, manifest?.branch),
    sha: pullRequest.headRefOid,
    checks: pullRequest.statusCheckRollup,
    reviews: pullRequest.reviews,
    inlineThreads,
    now: Date.now(),
    leaseOwner: `${process.pid}:${issue}`,
  };
}

function mapRemoteComment(comment: { body: string; createdAt?: string; id?: number }) {
  return {
    body: comment.body,
    ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
    ...(comment.id ? { id: comment.id } : {}),
  };
}

function findRemoteMarkers(comments: readonly { body: string }[]): string[] {
  return comments.flatMap((comment) => markersFromBody(comment.body));
}

function markersFromBody(body: string): string[] {
  return [...body.matchAll(/(?:sloop\/v1\/[^\s`]+|sloop-v1\/[^\s`]+)/g)].map((match) => match[0]);
}

function firstDefined<T>(first: T | undefined, fallback: T | undefined): T | undefined {
  return first ?? fallback;
}
