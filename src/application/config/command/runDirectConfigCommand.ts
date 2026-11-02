import { configPaths, getConfigField } from '../../../config.js';
import type { ConfigCommandContext, ConfigCommandRequest } from '../configCommandTypes.js';
import { setConfigValue } from '../setConfigValue.js';
import { initializeConfig } from './initializeConfig.js';
import { showConfig } from './showConfig.js';

type DirectConfigRoute = (
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
) => Promise<number | undefined> | number | undefined;

/** Runs direct config routes in their legacy precedence order. */
export async function runDirectConfigCommand(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  for (const route of directConfigRoutes) {
    const result = await route(command, request);
    if (result !== undefined) return result;
  }
  return undefined;
}

async function routeShowConfig(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  if (request.positional[0] !== 'show') return undefined;
  return showConfig.run(request.file, request.positional[1], command.logger, command.fileStore);
}

function routeUnknownScope(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): number | undefined {
  if (!isUnknownScope(request.positional)) return undefined;
  return fail(
    `unknown path ${request.positional[0]}; valid paths: ${configPaths().join(', ')}`,
    command.logger,
  );
}

async function routeConfigInit(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  if (!request.init || request.wizardMode) return undefined;
  const force = command.args.includes('--force') || command.args.includes('--force-sync');
  return initializeConfig.run(command, request.file, force);
}

async function routeScalarConfigValue(
  command: ConfigCommandContext,
  request: ConfigCommandRequest,
): Promise<number | undefined> {
  const { root, reconciler, io, logger, fileStore } = command;
  const { file, init, positional, sync } = request;
  if (init || positional.length < 2) return undefined;
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
}

const directConfigRoutes: readonly DirectConfigRoute[] = [
  routeShowConfig,
  routeUnknownScope,
  routeConfigInit,
  routeScalarConfigValue,
];

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
