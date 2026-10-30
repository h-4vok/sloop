import { execFileSync } from 'node:child_process';
import type { SloopConfig } from '../../config.js';

export type SyncRunner = (file: string, args: readonly string[], cwd: string) => string;
export type SyncOptions = { runner?: SyncRunner; output?: (message: string) => void };

const defaultRunner: SyncRunner = (file, args, cwd) =>
  execFileSync(file, [...args], { cwd, encoding: 'utf8' });

function getGitHubRepository(remote: string): string {
  const normalizedRemote = remote.replace(/\.git$/, '').replace(/\\/g, '/');
  const match = normalizedRemote.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  if (!match) throw new Error(`Configured remote is not a GitHub repository: ${remote}`);

  return match[1]!;
}

/** Validates skill configuration and resolves the GitHub repository used for sync. */
export function checkSyncPrerequisites(
  root: string,
  config: SloopConfig,
  injectedRunner?: SyncRunner,
): string {
  const legacyNames = config.skills.required.filter((name) => ['worker', 'qa-sdet'].includes(name));
  if (legacyNames.length)
    throw new Error(
      `Legacy skill names detected (${legacyNames.join(', ')}); run sloop config init before installing.`,
    );

  const runner = injectedRunner ?? defaultRunner;
  const remote = runner('git', ['remote', 'get-url', config.repository.remote], root).trim();

  return getGitHubRepository(remote);
}
