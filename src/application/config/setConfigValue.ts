import { createInterface } from 'node:readline/promises';
import type { Logger } from '../../core/Logger.js';
import { getConfigField, type ConfigFileStore } from '../../config.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from './configCommandTypes.js';
import { writeConfigValue } from './configValueWriter.js';
import { configValueValidationError } from './configValueValidation.js';

function fail(message: string, logger: Logger): number {
  logger.error(message);
  return 2;
}

/** Applies one scalar setting after validation, confirmation, and optional sync preflight. */
async function executeConfigValueSetter(
  root: string,
  file: string,
  path: string,
  raw: string,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight,
  io: WizardIO,
  logger: Logger,
  fileStore: ConfigFileStore,
): Promise<number> {
  const validationError = configValueValidationError(path, sync, file, fileStore);
  if (validationError) return fail(validationError, logger);
  const field = getConfigField(path)!;

  const rl = createInterface({ input: io.input, output: io.output });
  try {
    return await writeConfigValue(
      root,
      file,
      path,
      raw,
      sync,
      field.requiredReconciler,
      reconciler,
      io,
      logger,
      fileStore,
      rl,
    );
  } finally {
    rl.close();
  }
}

/** Applies scalar configuration updates through the injected app boundaries. */
export const setConfigValue = Object.freeze({ run: executeConfigValueSetter });
