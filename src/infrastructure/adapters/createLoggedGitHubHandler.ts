import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import type { GitHubProviderOptions } from './GitHubProviderOptions.js';

type GitHubHandler<T extends (...args: any[]) => any> = Readonly<{
  options: GitHubProviderOptions;
  operation: string;
  action: T;
  request?: (args: Parameters<T>) => unknown;
  response?: (result: ReturnType<T>, args: Parameters<T>) => unknown;
  logRequest: boolean;
  logResponse: boolean;
  wrapFailure: boolean;
  logError: boolean;
}>;

/** Wraps a provider operation with the configured GitHub logging and error policy. */
export function createLoggedGitHubHandler<T extends (...args: any[]) => any>(
  options: GitHubProviderOptions,
  operation: string,
  action: T,
  request?: (args: Parameters<T>) => unknown,
  response?: (result: ReturnType<T>, args: Parameters<T>) => unknown,
  logRequest = true,
  logResponse = true,
  wrapFailure = true,
  logError = true,
): T {
  const handler = {
    options,
    operation,
    action,
    request,
    response,
    logRequest,
    logResponse,
    wrapFailure,
    logError,
  } satisfies GitHubHandler<T>;
  return ((...args: Parameters<T>) => invokeGitHubHandler(handler, args)) as T;
}

function invokeGitHubHandler<T extends (...args: any[]) => any>(
  handler: GitHubHandler<T>,
  args: Parameters<T>,
): ReturnType<T> {
  try {
    logGitHubRequest(handler, args);
    const result = handler.action(...args);
    logGitHubResponse(handler, result, args);
    return result;
  } catch (error) {
    return reportGitHubFailure(handler, error);
  }
}

function logGitHubRequest<T extends (...args: any[]) => any>(
  handler: GitHubHandler<T>,
  args: Parameters<T>,
): void {
  if (handler.logRequest)
    handler.options.logGithub('request', handler.operation, handler.request?.(args));
}

function logGitHubResponse<T extends (...args: any[]) => any>(
  handler: GitHubHandler<T>,
  result: ReturnType<T>,
  args: Parameters<T>,
): void {
  if (handler.logResponse) {
    const response = handler.response ? handler.response(result, args) : result;
    handler.options.logGithub('response', handler.operation, response);
  }
}

function reportGitHubFailure<T extends (...args: any[]) => any>(
  handler: GitHubHandler<T>,
  error: unknown,
): never {
  if (handler.logError) handler.options.logGithub('error', handler.operation, errorMessage(error));
  if (handler.wrapFailure) throw wrapGitHubError(error);
  throw error;
}

function wrapGitHubError(error: unknown): ExternalServiceError {
  if (error instanceof ExternalServiceError) return error;
  return new ExternalServiceError('github', errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
