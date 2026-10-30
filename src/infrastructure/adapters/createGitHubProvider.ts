import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import type { Issue, PullRequest } from '../../dispatcher.js';
import { selectIssues } from '../../dispatcher.js';
import type { AdapterExec } from './AdapterExec.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { createIssueReader } from './github/createIssueReader.js';
import { createPullRequestReader } from './github/createPullRequestReader.js';
import { createPullRequestWriter } from './github/createPullRequestWriter.js';

type ProviderOptions = Readonly<{
  root: string;
  repository: string;
  eligibleLabel: string;
  priorityLabels: readonly string[];
  execute: AdapterExec;
  logGithub: (phase: string, operation: string, data: unknown) => void;
}>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const wrapGitHubError = (error: unknown) =>
  error instanceof ExternalServiceError
    ? error
    : new ExternalServiceError('github', messageOf(error));

function logHandler<T extends (...args: any[]) => any>(
  options: ProviderOptions,
  operation: string,
  action: T,
  request?: (args: Parameters<T>) => unknown,
  response?: (result: ReturnType<T>, args: Parameters<T>) => unknown,
  logRequest = true,
  logResponse = true,
  wrapFailure = true,
  logError = true,
): T {
  return ((...args: Parameters<T>) => {
    try {
      if (logRequest) options.logGithub('request', operation, request?.(args));
      const result = action(...args);
      if (logResponse)
        options.logGithub('response', operation, response ? response(result, args) : result);
      return result;
    } catch (error) {
      if (logError) options.logGithub('error', operation, messageOf(error));
      throw wrapFailure ? wrapGitHubError(error) : error;
    }
  }) as T;
}

export const gitHubProviderFactory = Object.freeze({
  create(options: ProviderOptions) {
    const client = gitHubCommandClientFactory.create(
      options.root,
      options.repository,
      options.execute,
    );
    const loadIssues = createIssueReader(client, options.eligibleLabel);
    const pullRequests = createPullRequestReader(client);
    const writer = createPullRequestWriter(client, options.root);
    const eligible = logHandler(
      options,
      'eligible',
      () => selectIssues(loadIssues(), options.priorityLabels),
      undefined,
      undefined,
      false,
    );
    const list: () => readonly { number: number; title: string }[] = logHandler(
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
    const pullRequest = logHandler(
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
    const pullRequestBody = logHandler(
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
    const comment = logHandler(
      options,
      'issue.comment',
      (issue: number, body: string) => writer.commentIssue(issue, body),
      ([issue, body]) => ({ issue, body }),
      (_result, [issue]) => ({ issue }),
    );
    const prComment = logHandler(
      options,
      'prComment',
      (number: number, body: string) => writer.commentPullRequest(number, body),
      ([pr, body]) => ({ pr, body }),
      (_result, [pr]) => ({ pr }),
      true,
      true,
      false,
    );
    const updatePullRequestBody = logHandler(
      options,
      'updatePullRequestBody',
      (number: number, body: unknown) => writer.updatePullRequest(number, body),
      ([pr, body]) => ({ pr, body }),
      (_result, [pr]) => ({ pr }),
      true,
      true,
      false,
    );
    const createIssue = logHandler(
      options,
      'issue.create',
      (title: string, body: string) => writer.createIssue(title, body),
      ([title, body]) => ({ title, body }),
      (issue) => ({ issue }),
    );

    return {
      eligible,
      list,
      pullRequest,
      pullRequestBody,
      comment,
      prComment,
      updatePullRequestBody,
      createIssue,
    };
  },
});
