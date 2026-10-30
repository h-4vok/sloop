import { join } from 'node:path';
import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { checkGitPrerequisites } from './checkGitPrerequisites.js';
import { createDiagnostic } from './checkSupport.js';

/** Checks configured Codex and required skill files. */
export const checkAgentPrerequisites = Object.freeze({
  checkCodex(io: RuntimeIo, root: string): Diagnostic[] {
    const codexFailure = checkGitPrerequisites.checkExecutable('codex', io, root);

    return codexFailure ? [codexFailure] : [];
  },

  checkRequiredSkills(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const failures: Diagnostic[] = [];
    for (const skill of config.skills.required) {
      const base =
        config.skills.scope === 'repository'
          ? join(root, '.codex', 'skills')
          : join(io.homeDirectory, '.codex', 'skills');
      const skillFile = join(base, skill, 'SKILL.md');
      if (io.canRead(skillFile)) continue;

      failures.push(
        createDiagnostic(
          'skills',
          `Required skill ${skill} is missing.`,
          `No safe repair command is available; install ${skill} in ${base}.`,
        ),
      );
    }

    return failures;
  },
});
