import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { checkAgentPrerequisites } from './checkAgentPrerequisites.js';
import { checkBranchPolicy } from './checkBranchPolicy.js';
import { checkGitPrerequisites } from './checkGitPrerequisites.js';
import { checkGitHubPrerequisites } from './checkGitHubPrerequisites.js';
import { checkNodeVersion } from './checkNodeVersion.js';

/** Composes shared and full doctor check sequences in their established order. */
export const checkCorePrerequisites = Object.freeze({
  commonChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    return [
      ...checkNodeVersion.checkPlatform(io),
      ...checkNodeVersion.checkNodeVersion(io),
      ...checkGitPrerequisites.checkGitAndRepository(config, io, root),
    ];
  },

  doctorChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    return [
      ...this.commonChecks(root, config, io),
      ...checkGitHubPrerequisites.githubChecks(root, config, io, true),
      ...checkAgentPrerequisites.checkCodex(io, root),
      ...checkAgentPrerequisites.checkRequiredSkills(root, config, io),
      ...checkBranchPolicy.checkWorkingTree(root, io),
      ...checkBranchPolicy.checkBranchPolicy(root, config, io),
    ];
  },
});
