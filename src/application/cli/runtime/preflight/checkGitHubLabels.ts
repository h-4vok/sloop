import type { SloopConfig } from '../../../../config.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { createDiagnostic } from './checkSupport.js';

/** Checks that configured workflow labels exist in the target repository. */
export const checkGitHubLabels = Object.freeze({
  checkRequiredLabels(
    repository: string,
    config: SloopConfig,
    io: RuntimeIo,
    root: string,
    allLabels: boolean,
  ): Diagnostic[] {
    const response = io.run(
      'gh',
      ['label', 'list', '--repo', repository, '--limit', '1000', '--json', 'name'],
      root,
    );
    if (response.status !== 0)
      return [
        createDiagnostic(
          'permissions',
          'Repository labels could not be read.',
          'Request repository read access.',
        ),
      ];

    return this.validateRequiredLabels(response.stdout, config, allLabels);
  },

  validateRequiredLabels(response: string, config: SloopConfig, allLabels: boolean): Diagnostic[] {
    const requiredLabels = allLabels
      ? [
          config.github.labels.eligible,
          config.github.labels.claimed,
          config.github.labels.blocked,
          ...config.github.labels.priority,
        ]
      : [config.github.labels.eligible];
    let names: string[];
    try {
      names = (JSON.parse(response) as { name: string }[]).map(({ name }) => name);
    } catch {
      return [
        createDiagnostic('labels', 'GitHub returned invalid label data.', 'Retry the command.'),
      ];
    }

    const missingLabels = requiredLabels.filter((name) => !names.includes(name));
    if (!missingLabels.length) return [];

    return [
      createDiagnostic(
        'labels',
        `Required labels are missing: ${missingLabels.join(', ')}.`,
        'Create the required labels.',
      ),
    ];
  },
});
