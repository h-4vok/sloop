import { createInterface } from 'node:readline/promises';
import { canonicalConfigYaml, loadConfigTextResult } from '../../../config.js';
import { migrateSkillNames } from '../../../sync.js';
import type { ConfigCommandContext } from '../configCommandTypes.js';

/** Creates default config or migrates existing skill names. */
async function executeConfigInitialization(
  command: ConfigCommandContext,
  file: string,
  forceSync: boolean,
): Promise<number> {
  const { root, io, logger, fileStore } = command;
  if (fileStore.exists(file)) return migrateExistingConfig(file, command);
  const readline = createInterface({ input: io.input, output: io.output });
  try {
    fileStore.writeAtomically(file, canonicalConfigYaml());
    logger.log(`Created ${file} with default configuration.`);
    if (await shouldSynchronizeInit(forceSync, command, readline))
      return await synchronizeInit(root, command);
    logger.log(
      'Prerequisites were not synchronized; run `sloop config install` to prepare them manually.',
    );

    return 0;
  } catch (error) {
    return fail(String(error instanceof Error ? error.message : error), logger);
  } finally {
    readline.close();
  }
}

/** Exposes config initialization and compatibility migration. */
export const initializeConfig = Object.freeze({ run: executeConfigInitialization });

function migrateExistingConfig(file: string, command: ConfigCommandContext): number {
  const { logger, fileStore } = command;
  const source = fileStore.read(file);
  const migrated = migrateSkillNames(source);
  if (migrated === source) {
    logger.log(`${file} already exists; leaving it unchanged.`);

    return 0;
  }
  const result = loadConfigTextResult(migrated, createUnknownConfigWarning(command));
  if (!result.ok) return fail(result.error.message, logger);
  fileStore.writeAtomically(file, migrated);
  logger.log(`Migrated legacy skill names in ${file}.`);

  return 0;
}

function createUnknownConfigWarning(command: ConfigCommandContext): (path: string) => void {
  return (path) => command.logger.error(`${path}: unknown configuration key; ignoring it`);
}

async function shouldSynchronizeInit(
  forceSync: boolean,
  command: ConfigCommandContext,
  readline: ReturnType<typeof createInterface>,
): Promise<boolean> {
  if (forceSync) return true;
  const { input, output } = command.io;

  return Boolean(
    input.isTTY &&
    output.isTTY &&
    (await readline.question('Synchronize GitHub labels and Sloop skills now? [Y/n] '))
      .trim()
      .toLowerCase() !== 'n',
  );
}

async function synchronizeInit(root: string, command: ConfigCommandContext): Promise<number> {
  try {
    await command.reconciler(root, 'github');

    return 0;
  } catch (error) {
    return fail(
      `Synchronization failed: ${error instanceof Error ? error.message : String(error)}`,
      command.logger,
    );
  }
}

function fail(message: string, logger: ConfigCommandContext['logger']): number {
  logger.error(message);

  return 2;
}
