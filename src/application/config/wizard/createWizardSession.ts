import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdout as output } from 'node:process';
import { canonicalConfigYaml, loadConfigTextResult } from '../../../config.js';
import type { ConfigFileStore } from '../../../config.js';
import type { Logger } from '../../../core/Logger.js';
import { migrateSkillNames } from '../../../sync.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from '../configCommandTypes.js';
import type { WizardSession } from './WizardSession.js';

/** Loads existing config or canonical defaults into a new interactive session. */
export function createWizardSession(
  root: string,
  file: string,
  init: boolean,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight,
  io: WizardIO,
  logger: Logger,
  fileStore: ConfigFileStore,
): { ok: true; value: WizardSession } | { ok: false; error: string } {
  logLegacyConfigWarning(root, init, logger, fileStore);
  const source = fileStore.exists(file) ? fileStore.read(file) : canonicalConfigYaml();
  const initialSource = init ? migrateSkillNames(source) : source;
  const warning = (path: string) => logger.error(`${path}: unknown configuration key; ignoring it`);
  const configResult = loadConfigTextResult(initialSource, warning);
  if (!configResult.ok) return { ok: false, error: configResult.error.message };
  const changed = initialConfigChanges(init, file, fileStore);

  return {
    ok: true,
    value: {
      root,
      file,
      init,
      sync,
      reconciler,
      io,
      logger,
      fileStore,
      current: configResult.value,
      next: initialSource,
      changed,
      asked: new Set<string>(),
      warning,
      useColor: io.useColor ?? isColorOutputEnabled(io.output === output),
      readline: createInterface({ input: io.input, output: io.output }),
    },
  };
}

function logLegacyConfigWarning(
  root: string,
  init: boolean,
  logger: Logger,
  fileStore: ConfigFileStore,
): void {
  const legacy = join(root, 'sloop.config.json');
  if (init && fileStore.exists(legacy))
    logger.log(`Legacy JSON detected at ${legacy}; it will remain untouched and inert.`);
}

function initialConfigChanges(init: boolean, file: string, fileStore: ConfigFileStore): string[] {
  if (!init || fileStore.exists(file)) return [];
  return ['sloop.config.yaml: missing -> canonical v1 configuration'];
}

function isColorOutputEnabled(isProcessOutput: boolean): boolean {
  return isProcessOutput && !process.env.NO_COLOR;
}
