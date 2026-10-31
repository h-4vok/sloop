import {
  configFileStore,
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  type ConfigFileStore,
} from '../../../config.js';
import type { Logger } from '../../../core/Logger.js';

/** Displays a YAML config or one validated field value. */
function executeConfigShow(
  file: string,
  path: string | undefined,
  logger: Logger,
  fileStore: ConfigFileStore = configFileStore,
): number {
  if (!fileStore.exists(file))
    return fail('No valid sloop.config.yaml; run sloop config init', logger);
  try {
    const configResult = loadConfigTextResult(fileStore.read(file), (unknownPath) =>
      logger.error(`${unknownPath}: unknown configuration key; ignoring it`),
    );
    if (!configResult.ok) return fail(configResult.error.message, logger);
    return showConfigValue(file, path, configResult.value, logger, fileStore);
  } catch (error) {
    return fail(errorMessage(error), logger);
  }
}

/** Exposes the config show command service. */
export const showConfig = Object.freeze({ run: executeConfigShow });

function fail(message: string, logger: Logger): number {
  logger.error(message);

  return 2;
}

function showConfigValue(
  file: string,
  path: string | undefined,
  config: unknown,
  logger: Logger,
  fileStore: ConfigFileStore,
): number {
  if (!path) {
    logger.log(fileStore.read(file));
    return 0;
  }
  validateConfigPath(path);
  logger.log(JSON.stringify(configValue(config as never, path)));
  return 0;
}

function validateConfigPath(path: string): void {
  const field = getConfigField(path);
  if (!field && configPaths(path).length === 0)
    throw new Error(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
