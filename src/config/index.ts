import { configFileStore } from './createNodeConfigFileStore.js';
import { configQueries } from './configQueries.js';
import { configYaml } from './configYaml.js';
import { configValidator } from './parseConfig.js';
import { ConfigValidationError } from './types.js';
import type { FieldMetadata, SloopConfig } from './types.js';
import type { Result } from './Result.js';

export { ConfigValidationError, configFileStore, configQueries, configValidator, configYaml };
export type {
  ConfigDiagnostic,
  ConfigValueType,
  FieldMetadata,
  Reconciler,
  RunnerConfig,
  Sensitivity,
  SloopConfig,
} from './types.js';
export type { ConfigFileStore } from './ConfigFileStore.js';
export type { Result } from './Result.js';
export { configRegistry, getConfigField } from './configRegistry.js';

export const parseConfigResult = configValidator.parseConfigResult;
export const loadConfigTextResult = configYaml.loadConfigTextResult;
export const updateConfigTextResult = configYaml.updateConfigTextResult;
export const parseConfigValueResult = configQueries.parseConfigValueResult;
export const configFingerprint = configQueries.configFingerprint;
export const configValue = configQueries.configValue;
export const configPaths = configQueries.configPaths;

/** Preserves the original throwing API for callers that have not migrated. */
export const parseConfigValue = (field: FieldMetadata, value: string): unknown =>
  requireConfigSuccess(configQueries.parseConfigValueResult(field, value));
export const parseConfig = (value: unknown): SloopConfig =>
  requireConfigSuccess(configValidator.parseConfigResult(value, warnUnknownConfigKey));
export const loadConfigText = (source: string): SloopConfig =>
  requireConfigSuccess(configYaml.loadConfigTextResult(source, warnUnknownConfigKey));
export const updateConfigText = (source: string, path: string, value: unknown): string =>
  requireConfigSuccess(
    configYaml.updateConfigTextResult(source, path, value, warnUnknownConfigKey),
  );
export const canonicalConfigYaml = configYaml.canonicalConfigYaml;

/** Preserves the original throwing file API at the Node storage boundary. */
export const loadConfigFile = configFileStore.loadConfigFile;
export const updateConfigFile = configFileStore.updateConfigFile;
export const configFileExists = configFileStore.exists;

/** Unwraps a result for legacy exports that preserve the original throwing API. */
function requireConfigSuccess<T>(result: Result<T, ConfigValidationError>): T {
  if (result.ok) return result.value;
  throw result.error;
}

function warnUnknownConfigKey(path: string): void {
  console.warn(`${path}: unknown configuration key; ignoring it`);
}
