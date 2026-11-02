import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { createIssueReader } from './github/createIssueReader.js';
import { createPullRequestReader } from './github/createPullRequestReader.js';
import { createPullRequestWriter } from './github/createPullRequestWriter.js';
import { createGitHubProviderHandlers } from './createGitHubProviderHandlers.js';
import type { GitHubProviderOptions } from './GitHubProviderOptions.js';

/** Creates issue, pull request, and comment operations for one repository. */
export const gitHubProviderFactory = Object.freeze({
  create(options: GitHubProviderOptions) {
    const client = gitHubCommandClientFactory.create(
      options.root,
      options.repository,
      options.execute,
    );
    const loadIssues = createIssueReader(client, options.eligibleLabel);
    const pullRequests = createPullRequestReader(client);
    const writer = createPullRequestWriter(client, options.root);

    return {
      ...createGitHubProviderHandlers.issues(options, loadIssues),
      ...createGitHubProviderHandlers.pullRequests(options, pullRequests),
      ...createGitHubProviderHandlers.writers(options, writer),
    };
  },
});
