/** Coordinates issue selection operations for dispatcher workflows. */
import type { DispatcherHost, Issue } from '../../../application/dispatcher/types/index.js';
import { issueLabelNames } from '../../../issue-selection.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { GitHubCli } from './GitHubCli.js';
const { ghJson } = GitHubCli;

function eligible(
  cwd = defaultRoot,
  repository?: string,
  label = 'Automation Ready',
  host?: DispatcherHost,
): Issue[] {
  const issues = ghJson<
    (Omit<Issue, 'labels'> & { labels?: readonly (string | { name?: string })[] })[]
  >(
    [
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
    ],
    cwd,
    repository,
    host,
  ).map((issue) => ({ ...issue, labels: issueLabelNames(issue.labels) }));
  return selectIssues(issues, []);
}

function selectIssues(issues: readonly Issue[], priorityLabels: readonly string[] = []): Issue[] {
  const priorities = new Map(priorityLabels.map((label, index) => [label, index]));
  return [...issues].sort((a, b) => {
    const priority = (issue: Issue) =>
      Math.min(...issueLabelNames(issue.labels).map((label) => priorities.get(label) ?? Infinity));
    return priority(a) - priority(b) || a.number - b.number;
  });
}

export const IssueSelection = {
  eligible,

  selectIssues,
};
