import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { cleanOutput, createDiagnostic } from './checkSupport.js';

/** Checks Git availability, the configured remote, and the configured base. */
export const checkGitPrerequisites = Object.freeze({
  checkExecutable(name: string, io: RuntimeIo, root: string): Diagnostic | undefined {
    const execution = io.run(name, ['--version'], root);
    if (execution.status === 0) return undefined;

    const output = cleanOutput(execution.stderr || execution.stdout)
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    const details = output ? ` Output: ${output}` : '';

    return createDiagnostic(
      name,
      `${name} --version failed with exit status ${execution.status}.${details}`,
      `Install ${name} and ensure it is on PATH.`,
    );
  },

  checkGitAndRepository(config: SloopConfig, io: RuntimeIo, root: string): Diagnostic[] {
    const failures: Diagnostic[] = [];
    const gitFailure = this.checkExecutable('git', io, root);
    if (gitFailure) failures.push(gitFailure);
    failures.push(...this.checkRemoteAndBase(config, io, root));

    return failures;
  },

  checkRemoteAndBase(config: SloopConfig, io: RuntimeIo, root: string): Diagnostic[] {
    const failures: Diagnostic[] = [];
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    if (remote.status !== 0)
      failures.push(
        createDiagnostic(
          'remote',
          `Configured remote ${config.repository.remote} does not exist.`,
          `Add the ${config.repository.remote} remote with the GitHub repository URL.`,
        ),
      );

    const base = `${config.repository.remote}/${config.repository.baseBranch}^{commit}`;
    const branch = io.run('git', ['rev-parse', '--verify', base], root);
    if (branch.status !== 0)
      failures.push(
        createDiagnostic(
          'base-branch',
          `Configured base ${config.repository.remote}/${config.repository.baseBranch} is unavailable.`,
          `Fetch ${config.repository.remote} ${config.repository.baseBranch}.`,
        ),
      );

    return failures;
  },
});
