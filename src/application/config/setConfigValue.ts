import { createInterface } from 'node:readline/promises';
import type { Logger } from '../../core/Logger.js';
import type { ConfigReconcilerKind } from '../../core/config/ConfigReconcilerKind.js';
import {
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  parseConfigValueResult,
  updateConfigTextResult,
  type ConfigFileStore,
} from '../../config.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from './configCommandTypes.js';

const CANONICAL = new Set([
  'github.labels.eligible',
  'github.labels.claimed',
  'github.labels.blocked',
  'github.labels.priority',
  'workflow.reviewOrder',
]);

function fail(message: string, logger: Logger): number {
  logger.error(message);
  return 2;
}

function createUnknownConfigWarning(logger: Logger): (path: string) => void {
  return (path) => logger.error(`${path}: unknown configuration key; ignoring it`);
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
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
  const field = getConfigField(path);
  if (!field) return fail(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`, logger);
  if (CANONICAL.has(path)) return fail(`${path} is canonical and read-only in v1; see #55`, logger);
  if (!fileStore.exists(file))
    return fail('No valid sloop.config.yaml; run sloop config init', logger);
  if (field.type === 'list' || field.type === 'argv')
    return fail(`${path}: complex values require the interactive wizard`, logger);
  if (field.requiredReconciler !== 'none' && sync === undefined)
    return fail(`${path} affects ${field.requiredReconciler}; specify --sync or --no-sync`, logger);

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

async function writeConfigValue(
  root: string,
  file: string,
  path: string,
  raw: string,
  sync: string | undefined,
  requiredReconciler: ConfigReconcilerKind,
  reconciler: ConfigReconcilerWithPreflight,
  io: WizardIO,
  logger: Logger,
  fileStore: ConfigFileStore,
  rl: ReturnType<typeof createInterface>,
): Promise<number> {
  try {
    const source = fileStore.read(file);
    const warning = createUnknownConfigWarning(logger);
    const configResult = loadConfigTextResult(source, warning);
    if (!configResult.ok) return fail(configResult.error.message, logger);
    const field = getConfigField(path)!;
    const valueResult = parseConfigValueResult(field, raw);
    if (!valueResult.ok) return fail(valueResult.error.message, logger);
    const value = valueResult.value;
    const updateResult = updateConfigTextResult(source, path, value, warning);
    if (!updateResult.ok) return fail(updateResult.error.message, logger);
    const next = updateResult.value;
    if (sync === '--sync' && requiredReconciler !== 'none')
      reconciler.preflight?.(root, requiredReconciler);
    logger.log(
      `Preview\n${path}: ${display(configValue(configResult.value, path))} -> ${display(value)}\nConfirm changes? [y/N]`,
    );
    if (io.input.isTTY && io.output.isTTY && (await rl.question('> ')).trim().toLowerCase() !== 'y')
      return 0;
    fileStore.writeAtomically(file, next);
    logger.log('Configuration written atomically.');
    if (sync === '--sync') {
      await reconciler(root, requiredReconciler);
      logger.log(`Synchronization completed for ${requiredReconciler}.`);
    }
    return 0;
  } catch (error) {
    return fail(String(error instanceof Error ? error.message : error), logger);
  }
}
