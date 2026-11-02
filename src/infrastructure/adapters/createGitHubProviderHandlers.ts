import type { Issue } from '../../dispatcher.js';
import { selectIssues } from '../../dispatcher.js';
import type { GitHubProviderOptions } from './GitHubProviderOptions.js';
import { createLoggedGitHubHandler } from './createLoggedGitHubHandler.js';
import { createIssueReader } from './github/createIssueReader.js';
import { createPullRequestReader } from './github/createPullRequestReader.js';
import { createPullRequestWriter } from './github/createPullRequestWriter.js';

/** Creates the logged operation handlers exposed by the GitHub provider. */
export const createGitHubProviderHandlers = Object.freeze({
  issues(options: GitHubProviderOptions, loadIssues: () => readonly Issue[]) {
    const eligible = createLoggedGitHubHandler(
      options,
      'eligible',
      () => selectIssues(loadIssues(), options.priorityLabels),
      undefined,
      undefined,
      false,
    );
    const list = createLoggedGitHubHandler(
      options,
      'eligible',
      () =>
        selectIssues(loadIssues(), options.priorityLabels).map(({ number, title }) => ({
          number,
          title,
        })),
      undefined,
      undefined,
      false,
      false,
      true,
      false,
    );

    return { eligible, list };
  },

  pullRequests(
    options: GitHubProviderOptions,
    pullRequests: ReturnType<typeof createPullRequestReader>,
  ) {
    const pullRequest = createLoggedGitHubHandler(
      options,
      'pullRequest',
      (number: number) => pullRequests.read(number),
      ([number]) => ({ pr: number }),
      undefined,
      undefined,
      true,
      true,
      false,
    );
    const pullRequestBody = createLoggedGitHubHandler(
      options,
      'pullRequestBody',
      (number: number) => pullRequests.readBody(number),
      ([number]) => ({ pr: number }),
      undefined,
      undefined,
      true,
      true,
      false,
    );

    return { pullRequest, pullRequestBody };
  },

  writers(options: GitHubProviderOptions, writer: ReturnType<typeof createPullRequestWriter>) {
    const comment = createLoggedGitHubHandler(
      options,
      'issue.comment',
      (issue: number, body: string) => writer.commentIssue(issue, body),
      ([issue, body]) => ({ issue, body }),
      (_result, [issue]) => ({ issue }),
    );
    const prComment = createLoggedGitHubHandler(
      options,
      'prComment',
      (number: number, body: string) => writer.commentPullRequest(number, body),
      ([pr, body]) => ({ pr, body }),
      (_result, [pr]) => ({ pr }),
      true,
      true,
      false,
    );
    const updatePullRequestBody = createLoggedGitHubHandler(
      options,
      'updatePullRequestBody',
      (number: number, body: unknown) => writer.updatePullRequest(number, body),
      ([pr, body]) => ({ pr, body }),
      (_result, [pr]) => ({ pr }),
      true,
      true,
      false,
    );
    const createIssue = createLoggedGitHubHandler(
      options,
      'issue.create',
      (title: string, body: string) => writer.createIssue(title, body),
      ([title, body]) => ({ title, body }),
      (issue) => ({ issue }),
    );

    return { comment, prComment, updatePullRequestBody, createIssue };
  },
});
