import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { checkGitPrerequisites } from './checkGitPrerequisites.js';
import { checkGitHubIdentity } from './checkGitHubIdentity.js';
import { checkGitHubLabels } from './checkGitHubLabels.js';
import { cleanOutput, createDiagnostic } from './checkSupport.js';

/** Coordinates GitHub authentication, repository identity, permissions, and labels. */
export const checkGitHubPrerequisites = Object.freeze({
  githubChecks(root: string, config: SloopConfig, io: RuntimeIo, allLabels = false): Diagnostic[] {
    const ghFailure = checkGitPrerequisites.checkExecutable('gh', io, root);
    if (ghFailure) return [ghFailure];

    const failures = this.checkGitHubAuthentication(io, root);
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    const remoteUrl = cleanOutput(remote.stdout);
    if (remote.status !== 0 || !remoteUrl) return failures;

    const identity = checkGitHubIdentity.readGitHubIdentity(remoteUrl, root, io, allLabels);
    failures.push(...identity.failures);
    if (!identity.repository) return failures;

    failures.push(
      ...checkGitHubLabels.checkRequiredLabels(identity.repository, config, io, root, allLabels),
    );

    return failures;
  },

  checkGitHubAuthentication(io: RuntimeIo, root: string): Diagnostic[] {
    if (io.run('gh', ['auth', 'status'], root).status === 0) return [];

    return [
      createDiagnostic('github-auth', 'GitHub CLI is not authenticated.', 'Run `gh auth login`.'),
    ];
  },
});
