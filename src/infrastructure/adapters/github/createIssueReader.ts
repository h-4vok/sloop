import type { Issue } from '../../../dispatcher.js';
import { issueLabelNames } from '../../../issue-selection.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;

/** Loads eligible issues and normalizes GitHub's alternate label payloads. */
export function createIssueReader(client: GitHubCommandClient, label: string): () => Issue[] {
  return () => {
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
  };
}
