import { createInterface } from 'node:readline/promises';
import type { ConfigCommandContext } from '../configCommandTypes.js';

/** Installs config-managed prerequisites after an optional confirmation. */
async function executeConfigInstall(
  command: ConfigCommandContext,
  file: string,
  forceSync: boolean,
): Promise<number> {
  const { root, reconciler, io, logger, fileStore } = command;
  if (!fileStore.exists(file))
    return fail('No valid sloop.config.yaml; run sloop config init', logger);
  if (!forceSync) {
    if (!hasInstallTerminal(io))
      return fail(
        'sloop config install requires a TTY; use --force for non-interactive installation',
        logger,
      );
    if (!(await confirmConfigInstall(io))) {
      logger.log('Installation skipped.');
      return 0;
    }
  }
  return synchronizeConfigInstall(root, reconciler, logger);
}

function hasInstallTerminal(io: ConfigCommandContext['io']): boolean {
  return Boolean(io.input.isTTY && io.output.isTTY);
}

async function confirmConfigInstall(io: ConfigCommandContext['io']): Promise<boolean> {
  const readline = createInterface({ input: io.input, output: io.output });
  try {
    const answer = await readline.question(
      'Install configured GitHub labels and Sloop skills now? [Y/n] ',
    );
    return answer.trim().toLowerCase() !== 'n';
  } finally {
    readline.close();
  }
}

async function synchronizeConfigInstall(
  root: string,
  reconciler: ConfigCommandContext['reconciler'],
  logger: ConfigCommandContext['logger'],
): Promise<number> {
  try {
    await reconciler(root, 'github');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Synchronization failed: ${message}`, logger);
  }
}

/** Exposes the config install command service. */
export const installConfig = Object.freeze({ run: executeConfigInstall });

function fail(message: string, logger: ConfigCommandContext['logger']): number {
  logger.error(message);

  return 2;
}
