import { parseRunManifestMarker } from '../../../remote-state.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';
import type { RunManifest } from '../../../remote-state.js';

type Client = ReturnType<typeof gitHubCommandClientFactory.create>;

export type PullRequestSnapshot = Readonly<{
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

/** Reads the PR details and inline review threads for a manifest's PR. */
export function readRemotePullRequest(client: Client, repository: string, number: number) {
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

/** Parses manifest markers from issue and pull request comments. */
export function readRunManifests(
  comments: readonly { body: string }[],
  issue: number,
): RunManifest[] {
  return comments
    .map(({ body }) => parseRunManifestMarker(body, issue))
    .filter((manifest): manifest is RunManifest => Boolean(manifest));
}
