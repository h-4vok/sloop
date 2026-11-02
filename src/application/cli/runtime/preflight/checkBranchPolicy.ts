import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { cleanOutput, createDiagnostic } from './checkSupport.js';

/** Checks Git status and configured branch policy. */
export const checkBranchPolicy = Object.freeze({
  checkWorkingTree(root: string, io: RuntimeIo): Diagnostic[] {
    if (io.run('git', ['status', '--porcelain'], root).status === 0) return [];

    return [
      createDiagnostic(
        'working-tree',
        'Working tree status failed.',
        'No safe repair command is available because the checkout status could not be inspected.',
      ),
    ];
  },

  checkBranchPolicy(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const branch = io.run('git', ['symbolic-ref', '--short', 'HEAD'], root);
    const branchName = cleanOutput(branch.stdout);
    if (branch.status !== 0 || !branchName)
      return [
        createDiagnostic(
          'branch-policy',
          'The checkout has a detached HEAD.',
          'Check out the configured base or a Sloop worker branch.',
        ),
      ];
    if (
      branchName === config.repository.baseBranch ||
      branchName.startsWith(config.repository.branchPrefix)
    )
      return [];

    return [
      createDiagnostic(
        'branch-policy',
        `Branch ${branchName} violates the configured branch policy.`,
        `Use ${config.repository.baseBranch} or ${config.repository.branchPrefix}<issue>.`,
      ),
    ];
  },
});
