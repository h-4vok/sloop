/** Coordinates git hub cli operations for dispatcher workflows. */
import type { DispatcherHost } from '../../../application/dispatcher/types/index.js';
import { runSyncCommand, resolveExecutable } from '../../../process.js';
import { CliFailure } from '../types/CliFailure.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;

function gh(
  args: string[],
  cwd = defaultRoot,
  repository?: string,
  host: DispatcherHost = {},
): string {
  // `gh api` has no `--repo` flag. API requests must scope themselves through
  // their endpoint or request fields; regular gh commands use `--repo`.
  const scoped =
    repository && args[0] !== 'api' && !args.includes('--repo')
      ? [...args, '--repo', repository]
      : args;
  try {
    return (host.runSyncCommand ?? runSyncCommand)(
      (host.resolveExecutable ?? resolveExecutable)('gh', host.platform ?? process.platform),
      scoped,
      undefined,
      host.platform ?? process.platform,
      host.comSpec ?? process.env.ComSpec,
      cwd,
    );
  } catch (error) {
    throw new CliFailure(5, error instanceof Error ? error.message : String(error));
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
    throw new CliFailure(
      5,
      `gh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const GitHubCli = {
  gh,
  ghJson,
};
