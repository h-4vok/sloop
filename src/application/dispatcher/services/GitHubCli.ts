/** Coordinates git hub cli operations for dispatcher workflows. */
import type { DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { runSyncCommand, resolveExecutable } from '../../../process.js';
import { CliFailure } from '../types/CliFailure.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;

function scopeGitHubArguments(args: string[], repository?: string): string[] {
  return repository && args[0] !== 'api' && !args.includes('--repo')
    ? [...args, '--repo', repository]
    : args;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveGitHubExecution(host: DispatcherHost) {
  const platform = host.platform ?? process.platform;

  return {
    executable: (host.resolveExecutable ?? resolveExecutable)('gh', platform),
    platform,
    comSpec: host.comSpec ?? process.env.ComSpec,
    run: host.runSyncCommand ?? runSyncCommand,
  };
}

function gh(
  args: string[],
  cwd = defaultRoot,
  repository?: string,
  host: DispatcherHost = {},
): string {
  // `gh api` has no `--repo` flag. API requests must scope themselves through
  // their endpoint or request fields; regular gh commands use `--repo`.
  const scoped = scopeGitHubArguments(args, repository);
  const execution = resolveGitHubExecution(host);
  try {
    return execution.run(
      execution.executable,
      scoped,
      undefined,
      execution.platform,
      execution.comSpec,
      cwd,
    );
  } catch (error) {
    throw new CliFailure(5, errorMessage(error));
  }
}

function ghJson<T>(
  args: string[],
  cwd = defaultRoot,
  repository?: string,
  host: DispatcherHost = {},
): T {
  const output = gh(args, cwd, repository, host);
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new CliFailure(5, `gh returned invalid JSON: ${errorMessage(error)}`);
  }
}

export const GitHubCli = {
  gh,

  ghJson,
};
