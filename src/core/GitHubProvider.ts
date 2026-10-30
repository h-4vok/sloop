/** GitHub operations required by dispatcher workflows. */
export interface GitHubProvider<Issue, PullRequest> {
  eligible(): Issue[];

  createIssue?(title: string, body: string): number;

  comment(issue: number, body: string): void;

  pullRequest(pr: number): Promise<PullRequest> | PullRequest;

  updatePullRequestBody(pr: number, body: string): void | Promise<void>;

  pullRequestBody(pr: number): string | Promise<string>;

  prComment(pr: number, body: string): void | Promise<void>;
}
