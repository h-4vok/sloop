import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import { parseRunManifestMarker } from '../../../remote-state.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';
type Client = ReturnType<typeof gitHubCommandClientFactory.create>;
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

function readPullRequest(client: Client, repository: string, number: number) {
  const pullRequest = client.runJson<PullRequestSnapshot>([
    'pr',
    'view',
    String(number),
    '--json',
    'number,state,mergedAt,baseRefName,headRefName,headRefOid,comments,reviews,statusCheckRollup',
  ]);
  const [owner, name] = repository.split('/', 2);
  if (!owner || !name) throw new Error('configured GitHub repository must be owner/name');
  const response = client.runJson<{
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: { nodes?: readonly { isResolved: boolean }[] };
        };
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
    `number=${number}`,
  ]);
  const threads = response.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return {
    pullRequest,
    inlineThreads: threads.map(({ isResolved }) => ({ resolved: isResolved })),
  };
}

function readManifests(comments: readonly { body: string }[], issue: number): RunManifest[] {
  return comments
    .map(({ body }) => parseRunManifestMarker(body, issue))
    .filter((manifest): manifest is RunManifest => Boolean(manifest));
}

/** Reads GitHub issue/PR state into the remote authority contract. */
export function createRemoteSnapshotReader(client: Client, repository: string) {
  return (issue: number): RemoteSnapshot => {
    const issueSnapshot = client.runJson<IssueSnapshot>([
      'issue',
      'view',
      String(issue),
      '--json',
      'state,labels,comments',
    ]);
    const issueComments = issueSnapshot.comments ?? [];
    const issueManifest = readManifests(issueComments, issue).at(-1);
    const details = issueManifest?.pr
      ? readPullRequest(client, repository, issueManifest.pr)
      : { pullRequest: {} as PullRequestSnapshot, inlineThreads: [] };
    const pullRequest = details.pullRequest;
    const comments = [...issueComments, ...(pullRequest.comments ?? [])];
    const manifest = readManifests(comments, issue).at(-1) ?? issueManifest;
    const markers = comments.flatMap(({ body }) =>
      [...body.matchAll(/(?:sloop\/v1\/[^\s`]+|sloop-v1\/[^\s`]+)/g)].map((match) => match[0]),
    );
    return {
      issue,
      issueState: issueSnapshot.state,
      labels: (issueSnapshot.labels ?? []).map(({ name }) => name),
      pr: pullRequest.number ?? manifest?.pr,
      prState: pullRequest.state,
      prMergedAt: pullRequest.mergedAt,
      prBaseBranch: pullRequest.baseRefName,
      comments: comments.map(({ body, createdAt, id }) => ({
        body,
        ...(createdAt ? { createdAt } : {}),
        ...(id ? { id } : {}),
      })),
      markers,
      manifest,
      branch: pullRequest.headRefName ?? manifest?.branch,
      sha: pullRequest.headRefOid,
      checks: pullRequest.statusCheckRollup,
      reviews: pullRequest.reviews,
      inlineThreads: details.inlineThreads,
      now: Date.now(),
      leaseOwner: `${process.pid}:${issue}`,
    };
  };
}
