import type { SloopConfig } from '../../config.js';
import { checkSyncPrerequisites, type SyncOptions } from './checkSyncPrerequisites.js';
import { executeSync } from './executeSync.js';

export type { SyncOptions, SyncRunner } from './checkSyncPrerequisites.js';

/** Coordinates repository validation and installation of Sloop sync assets. */
export function syncPrerequisites(
  root: string,
  config: SloopConfig,
  options: SyncOptions = {},
): void {
  const repository = checkSyncPrerequisites(root, config, options.runner);

  executeSync(root, config, repository, options);
}

/** Renames legacy required-skill entries when migrating configuration text. */
export function migrateSkillNames(configText: string): string {
  return configText.replace(
    /(^\s*- )(worker|qa-sdet)(\s*$)/gm,
    (_all, prefix, name, suffix) =>
      `${prefix}${name === 'worker' ? 'sloop-worker' : 'sloop-qa'}${suffix}`,
  );
}
