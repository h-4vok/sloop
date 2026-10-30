import { execFileSync } from 'node:child_process';
import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import type { AdapterExec } from './AdapterExec.js';
import type { AdapterExecOptions } from './AdapterExecOptions.js';

const nativeAdapterExec: AdapterExec = (file, args, options) =>
  execFileSync(file, [...args], options);

/** Creates a repository-scoped GitHub CLI client for production adapters. */
export const gitHubCommandClientFactory = Object.freeze({
  create(root: string, repository: string, execute: AdapterExec = nativeAdapterExec) {
    const run = (
      args: readonly string[],
      options: Omit<AdapterExecOptions, 'cwd'> = {},
    ): string => {
      try {
        const scopedArgs = args[0] === 'api' ? [...args] : [...args, '--repo', repository];

        return String(execute('gh', scopedArgs, { ...options, cwd: root }) ?? '');
      } catch (error) {
        throw new ExternalServiceError(
          'github',
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    const runJson = <T>(args: readonly string[]): T => {
      try {
        return JSON.parse(run(args)) as T;
      } catch (error) {
        if (error instanceof ExternalServiceError) throw error;

        throw new ExternalServiceError(
          'github',
          `gh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    return Object.freeze({ run, runJson });
  },
});
