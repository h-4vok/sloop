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

/** Exposes the config show command service. */
export const showConfig = Object.freeze({ run: executeConfigShow });

function fail(message: string, logger: Logger): number {
  logger.error(message);

  return 2;
}
