import { join } from 'node:path';
import type { ConfigCommandContext } from '../configCommandTypes.js';
import { configPaths, getConfigField } from '../../../config.js';
import { runConfigWizard } from '../runConfigWizard.js';
import { setConfigValue } from '../setConfigValue.js';
import { initializeConfig } from './initializeConfig.js';
import { installConfig } from './installConfig.js';
import { showConfig } from './showConfig.js';

type ConfigCommandRequest = Readonly<{
  file: string;
  init: boolean;
  wizardMode: boolean;
  syncFlags: readonly string[];
  sync?: string;
  positional: readonly string[];
}>;

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

async function runDirectConfigCommand(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  const { root, reconciler, io, logger, fileStore } = command;
  const { file, init, positional, sync } = request;
  if (positional[0] === 'show') return showConfig.run(file, positional[1], logger, fileStore);
  if (isUnknownScope(positional))
    return fail(`unknown path ${positional[0]}; valid paths: ${configPaths().join(', ')}`, logger);
  if (init && !request.wizardMode)
    return initializeConfig.run(
      command,
      file,
      command.args.includes('--force') || command.args.includes('--force-sync'),
    );
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

function isUnknownScope(positional: readonly string[]): boolean {
  return (
    positional.length === 1 &&
    !getConfigField(positional[0]!) &&
    configPaths(positional[0]!).length === 0
  );
}

function fail(message: string, logger: ConfigCommandContext['logger']): number {
  logger.error(message);

  return 2;
}
