import { join } from 'node:path';
import type { ConfigCommandContext, ConfigCommandRequest } from '../configCommandTypes.js';
import { runDirectConfigCommand } from './runDirectConfigCommand.js';
import { runConfigWizard } from '../runConfigWizard.js';
import { installConfig } from './installConfig.js';

/** Routes config commands and preserves their existing validation order. */
async function executeConfigCommandRoute(command: ConfigCommandContext): Promise<number> {
  const request = createConfigCommandRequest(command);
  const installResult = await runInstallIfRequested(command, request);
  if (installResult !== undefined) return installResult;
  const validationMessage = validateConfigCommandRequest(request);
  if (validationMessage) return fail(validationMessage, command.logger);
  const directResult = await runDirectConfigCommand(command, request);
  if (directResult !== undefined) return directResult;

  return runInteractiveConfigCommand(command, request);
}

function createConfigCommandRequest(command: ConfigCommandContext): ConfigCommandRequest {
  const { root, args } = command;
  const file = join(root, 'sloop.config.yaml');
  const init = args.includes('--init');
  const wizardMode = args.includes('--wizard');
  const syncFlags = args.filter((arg) => arg === '--sync' || arg === '--no-sync');
  return {
    file,
    init,
    wizardMode,
    syncFlags,
    sync: syncFlags[0],
    positional: args.filter((arg) => !arg.startsWith('--')),
  };
}

async function runInstallIfRequested(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  if (!command.args.includes('--install')) return undefined;

  return installConfig.run(
    command,
    request.file,
    command.args.includes('--force') || command.args.includes('--force-sync'),
  );
}

function validateConfigCommandRequest(request: ConfigCommandRequest): string | undefined {
  if (request.syncFlags.length > 1) return 'choose only one of --sync or --no-sync';
  if (request.wizardMode && !request.init) return '--wizard is only valid with sloop config init';

  return undefined;
}

async function runInteractiveConfigCommand(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number> {
  const { root, reconciler, io, logger, fileStore } = command;
  if (!io.input.isTTY || !io.output.isTTY)
    return fail(
      request.init
        ? 'sloop config init requires a TTY'
        : 'sloop config wizard requires a TTY; scalar setters and config show do not',
      logger,
    );

  return runConfigWizard.run(
    root,
    request.file,
    request.positional[0],
    request.init,
    request.sync,
    reconciler,
    io,
    logger,
    fileStore,
  );
}

/** Provides the configuration command routing service. */
export const routeConfigCommand = Object.freeze({ run: executeConfigCommandRoute });

function fail(message: string, logger: ConfigCommandContext['logger']): number {
  logger.error(message);

  return 2;
}
