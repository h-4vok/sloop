import { checkAgentPrerequisites } from './preflight/checkAgentPrerequisites.js';
import { checkBranchPolicy } from './preflight/checkBranchPolicy.js';
import { checkCorePrerequisites } from './preflight/checkCorePrerequisites.js';
import { checkGitPrerequisites } from './preflight/checkGitPrerequisites.js';
import { checkGitHubIdentity } from './preflight/checkGitHubIdentity.js';
import { checkGitHubLabels } from './preflight/checkGitHubLabels.js';
import { checkGitHubPrerequisites } from './preflight/checkGitHubPrerequisites.js';
import { checkNodeVersion } from './preflight/checkNodeVersion.js';
import { discoverRepository, loadRepositoryConfig } from './preflight/loadRepositoryConfig.js';
import { cleanOutput, createDiagnostic } from './preflight/checkSupport.js';
import { dispatcherChecks } from './preflight/dispatcherChecks.js';

/** Exposes boundary checks and coordinates their observable order for CLI commands. */
export const repositoryPreflight = Object.freeze({
  ...checkCorePrerequisites,

  ...dispatcherChecks,

  ...checkGitPrerequisites,

  ...checkGitHubPrerequisites,

  ...checkGitHubIdentity,

  ...checkGitHubLabels,

  ...checkAgentPrerequisites,

  ...checkBranchPolicy,

  ...checkNodeVersion,

  clean: cleanOutput,

  diagnostic: createDiagnostic,

  discoverRepository,

  loadBaseConfig: loadRepositoryConfig,
});
