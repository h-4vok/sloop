import type { Logger } from '../../core/Logger.js';
import type { ConfigReconcilerKind } from '../../core/config/ConfigReconcilerKind.js';
import {
  configValue,
  getConfigField,
  loadConfigTextResult,
  parseConfigValueResult,
  updateConfigTextResult,
  type ConfigFileStore,
} from '../../config.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from './configCommandTypes.js';

type ConfigValueUpdate = Readonly<{ current: unknown; next: string; value: unknown }>;
type UpdateResult = { ok: true; value: ConfigValueUpdate } | { ok: false; error: string };

/** Validates a scalar value and persists the confirmed update. */
export async function writeConfigValue(
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
  readline: { question(prompt: string): Promise<string> },
): Promise<number> {
  try {
    const updateResult = prepareConfigValueUpdate(path, raw, fileStore, file, logger);
    if (!updateResult.ok) return fail(updateResult.error, logger);
    runConfigValuePreflight(root, sync, requiredReconciler, reconciler);
    logConfigValuePreview(path, updateResult.value, logger);
    if (!(await confirmConfigValueUpdate(io, readline))) return 0;
    await persistConfigValueUpdate(
      file,
      updateResult.value.next,
      sync,
      requiredReconciler,
      root,
      reconciler,
      logger,
      fileStore,
    );
    return 0;
  } catch (error) {
    return fail(errorMessage(error), logger);
  }
}

function prepareConfigValueUpdate(
  path: string,
  raw: string,
  fileStore: ConfigFileStore,
  file: string,
  logger: Logger,
): UpdateResult {
  const source = fileStore.read(file);
  const warning = (unknownPath: string) =>
    logger.error(`${unknownPath}: unknown configuration key; ignoring it`);
  const configResult = loadConfigTextResult(source, warning);
  if (!configResult.ok) return { ok: false, error: configResult.error.message };
  const field = getConfigField(path)!;
  const valueResult = parseConfigValueResult(field, raw);
  if (!valueResult.ok) return { ok: false, error: valueResult.error.message };
  const updateResult = updateConfigTextResult(source, path, valueResult.value, warning);
  if (!updateResult.ok) return { ok: false, error: updateResult.error.message };
  return {
    ok: true,
    value: {
      current: configValue(configResult.value, path),
      next: updateResult.value,
      value: valueResult.value,
    },
  };
}

function runConfigValuePreflight(
  root: string,
  sync: string | undefined,
  requiredReconciler: ConfigReconcilerKind,
  reconciler: ConfigReconcilerWithPreflight,
): void {
  if (sync === '--sync' && requiredReconciler !== 'none')
    reconciler.preflight?.(root, requiredReconciler);
}

function logConfigValuePreview(path: string, update: ConfigValueUpdate, logger: Logger): void {
  const currentValue = display(update.current);
  const nextValue = display(update.value);
  logger.log(`Preview\n${path}: ${currentValue} -> ${nextValue}\nConfirm changes? [y/N]`);
}

async function confirmConfigValueUpdate(
  io: WizardIO,
  readline: { question(prompt: string): Promise<string> },
): Promise<boolean> {
  if (!io.input.isTTY || !io.output.isTTY) return true;
  const answer = await readline.question('> ');
  return answer.trim().toLowerCase() === 'y';
}

async function persistConfigValueUpdate(
  file: string,
  next: string,
  sync: string | undefined,
  requiredReconciler: ConfigReconcilerKind,
  root: string,
  reconciler: ConfigReconcilerWithPreflight,
  logger: Logger,
  fileStore: ConfigFileStore,
): Promise<void> {
  fileStore.writeAtomically(file, next);
  logger.log('Configuration written atomically.');
  if (sync !== '--sync') return;
  await reconciler(root, requiredReconciler);
  logger.log(`Synchronization completed for ${requiredReconciler}.`);
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string, logger: Logger): number {
  logger.error(message);
  return 2;
}
