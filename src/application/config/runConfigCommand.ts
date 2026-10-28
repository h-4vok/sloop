import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Logger } from '../../core/Logger.js';
import type { ConfigReconcilerKind } from '../../core/config/ConfigReconcilerKind.js';
import { consoleLogger } from '../../infrastructure/logging/consoleLogger.js';
import {
  canonicalConfigYaml,
  configFileStore,
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  type ConfigFileStore,
} from '../../config.js';
import { migrateSkillNames } from '../../sync.js';
import { runConfigWizard } from './runConfigWizard.js';
import { setConfigValue } from './setConfigValue.js';
import type {
  ConfigReconciler,
  ConfigReconcilerWithPreflight,
  WizardIO,
} from './configCommandTypes.js';

export type {
  ConfigReconciler,
  ConfigReconcilerWithPreflight,
  WizardIO,
} from './configCommandTypes.js';

/** The default fails clearly when no production reconciler adapter is installed. */
export const reconcileConfig: ConfigReconcilerWithPreflight = Object.assign(
  async (_root: string, kind: ConfigReconcilerKind) => {
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
    );
  },
  {
    preflight: (_root: string, kind: ConfigReconcilerKind) => {
      if (kind !== 'none')
        throw new Error(
          `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
        );
    },
  },
);

type ConfigCommandArgs = Readonly<{
  root: string;
  args: readonly string[];
  reconciler: ConfigReconcilerWithPreflight;
  io: WizardIO;
  logger: Logger;
  fileStore: ConfigFileStore;
}>;

/** Routes config CLI commands through injected reconciler and file boundaries. */
async function executeConfigCommand(
  root: string,
  args: readonly string[],
  reconciler: ConfigReconcilerWithPreflight = reconcileConfig,
  io: WizardIO = { input, output },
  logger: Logger = consoleLogger,
  fileStore: ConfigFileStore = configFileStore,
): Promise<number> {
  const command: ConfigCommandArgs = { root, args, reconciler, io, logger, fileStore };
  return routeConfigCommand(command);
}

async function routeConfigCommand(command: ConfigCommandArgs): Promise<number> {
  const { root, args, reconciler, io, logger, fileStore } = command;
  const file = join(root, 'sloop.config.yaml');
  const init = args.includes('--init');
  const wizardMode = args.includes('--wizard');
  const syncFlags = args.filter((arg) => arg === '--sync' || arg === '--no-sync');
  const sync = syncFlags[0];
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (args.includes('--install'))
    return installConfig(command, file, args.includes('--force') || args.includes('--force-sync'));
  if (syncFlags.length > 1) return fail('choose only one of --sync or --no-sync', logger);
  if (wizardMode && !init) return fail('--wizard is only valid with sloop config init', logger);
  if (positional[0] === 'show') return show(file, positional[1], logger, fileStore);
  if (isUnknownScope(positional))
    return fail(`unknown path ${positional[0]}; valid paths: ${configPaths().join(', ')}`, logger);
  if (init && !wizardMode)
    return directInit(command, file, args.includes('--force') || args.includes('--force-sync'));
  if (!init && positional.length >= 2)
    return setConfigValue.run(
      root,
      file,
      positional[0]!,
      positional.slice(1).join(' '),
      sync,
      reconciler,
      io,
      logger,
      fileStore,
    );
  if (!io.input.isTTY || !io.output.isTTY)
    return fail(
      init
        ? 'sloop config init requires a TTY'
        : 'sloop config wizard requires a TTY; scalar setters and config show do not',
      logger,
    );
  return runConfigWizard.run(
    root,
    file,
    positional[0],
    init,
    sync,
    reconciler,
    io,
    logger,
    fileStore,
  );
}

/** Routes configuration CLI requests through the application config services. */
export const runConfigCommand = Object.freeze({ run: executeConfigCommand });

function isUnknownScope(positional: readonly string[]): boolean {
  return (
    positional.length === 1 &&
    !getConfigField(positional[0]!) &&
    configPaths(positional[0]!).length === 0
  );
}

async function installConfig(
  command: ConfigCommandArgs,
  file: string,
  forceSync: boolean,
): Promise<number> {
  const { root, reconciler, io, logger, fileStore } = command;
  if (!fileStore.exists(file))
    return fail('No valid sloop.config.yaml; run sloop config init', logger);
  if (!forceSync) {
    if (!io.input.isTTY || !io.output.isTTY)
      return fail(
        'sloop config install requires a TTY; use --force for non-interactive installation',
        logger,
      );
    const readline = createInterface({ input: io.input, output: io.output });
    try {
      const answer = await readline.question(
        'Install configured GitHub labels and Sloop skills now? [Y/n] ',
      );
      if (answer.trim().toLowerCase() === 'n') {
        logger.log('Installation skipped.');
        return 0;
      }
    } finally {
      readline.close();
    }
  }
  try {
    await reconciler(root, 'github');
    return 0;
  } catch (error) {
    return fail(
      `Synchronization failed: ${error instanceof Error ? error.message : String(error)}`,
      logger,
    );
  }
}

async function directInit(
  command: ConfigCommandArgs,
  file: string,
  forceSync: boolean,
): Promise<number> {
  const { root, reconciler, io, logger, fileStore } = command;
  if (fileStore.exists(file)) return migrateExistingConfig(file, logger, fileStore);
  const readline = createInterface({ input: io.input, output: io.output });
  try {
    fileStore.writeAtomically(file, canonicalConfigYaml());
    logger.log(`Created ${file} with default configuration.`);
    const shouldSync = await shouldSynchronizeInit(forceSync, io, readline);
    if (shouldSync) return await synchronizeInit(root, reconciler, logger);
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

function migrateExistingConfig(file: string, logger: Logger, fileStore: ConfigFileStore): number {
  const source = fileStore.read(file);
  const migrated = migrateSkillNames(source);
  if (migrated === source) {
    logger.log(`${file} already exists; leaving it unchanged.`);
    return 0;
  }
  const result = loadConfigTextResult(migrated, createUnknownConfigWarning(logger));
  if (!result.ok) return fail(result.error.message, logger);
  fileStore.writeAtomically(file, migrated);
  logger.log(`Migrated legacy skill names in ${file}.`);
  return 0;
}

async function shouldSynchronizeInit(
  forceSync: boolean,
  io: WizardIO,
  readline: ReturnType<typeof createInterface>,
): Promise<boolean> {
  if (forceSync) return true;
  return Boolean(
    io.input.isTTY &&
    io.output.isTTY &&
    (await readline.question('Synchronize GitHub labels and Sloop skills now? [Y/n] '))
      .trim()
      .toLowerCase() !== 'n',
  );
}

async function synchronizeInit(
  root: string,
  reconciler: ConfigReconcilerWithPreflight,
  logger: Logger,
): Promise<number> {
  try {
    await reconciler(root, 'github');
    return 0;
  } catch (error) {
    return fail(
      `Synchronization failed: ${error instanceof Error ? error.message : String(error)}`,
      logger,
    );
  }
}

function fail(message: string, logger: Logger): number {
  logger.error(message);
  return 2;
}

function createUnknownConfigWarning(logger: Logger): (path: string) => void {
  return (path) => logger.error(`${path}: unknown configuration key; ignoring it`);
}

function show(
  file: string,
  path: string | undefined,
  logger: Logger,
  fileStore: ConfigFileStore,
): number {
  if (!fileStore.exists(file))
    return fail('No valid sloop.config.yaml; run sloop config init', logger);
  try {
    const configResult = loadConfigTextResult(
      fileStore.read(file),
      createUnknownConfigWarning(logger),
    );
    if (!configResult.ok) return fail(configResult.error.message, logger);
    if (!path) logger.log(fileStore.read(file));
    else {
      const field = getConfigField(path);
      if (!field && configPaths(path).length === 0)
        throw new Error(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
      logger.log(JSON.stringify(configValue(configResult.value, path)));
    }
    return 0;
  } catch (error) {
    return fail(String(error instanceof Error ? error.message : error), logger);
  }
}
