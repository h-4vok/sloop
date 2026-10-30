import { ConfigValidationError, type SloopConfig } from './types.js';
import { configRegistry } from './configRegistry.js';
import { findCredentialDiagnostics } from './credentialDiagnostics.js';
import type { Result } from './Result.js';
import { collectFieldDiagnostics } from './validation/configFieldDiagnostics.js';
import {
  findCrossFieldDiagnostics,
  findDependencyDiagnostics,
} from './validation/configCrossFieldDiagnostics.js';
import {
  buildAllowedConfigTree,
  filterKnownConfigValues,
  findContainerShapeDiagnostics,
  findUnknownConfigKeyPaths,
  isPlainObject,
} from './validation/configKeyDiagnostics.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }

  return value;
}

function parseConfigResult(
  value: unknown,
  onUnknownKey: (path: string) => void,
): Result<SloopConfig, ConfigValidationError> {
  if (!isPlainObject(value))
    return {
      ok: false,
      error: new ConfigValidationError([{ path: '$', message: 'expected a YAML mapping' }]),
    };

  const allowedTree = buildAllowedConfigTree();
  for (const unknownPath of findUnknownConfigKeyPaths(value, allowedTree))
    onUnknownKey(unknownPath);

  const diagnostics = [
    ...findContainerShapeDiagnostics(value, allowedTree),
    ...findCredentialDiagnostics(filterKnownConfigValues(value, allowedTree)),
  ];
  const outputConfig: Record<string, unknown> = {};
  diagnostics.push(
    ...collectFieldDiagnostics(outputConfig, value),
    ...findCrossFieldDiagnostics(outputConfig),
    ...findDependencyDiagnostics(outputConfig),
  );

  if (diagnostics.length) return { ok: false, error: new ConfigValidationError(diagnostics) };

  return { ok: true, value: deepFreeze(outputConfig as SloopConfig) };
}

/** Validates raw config and returns expected failures as structured data. */
export const configValidator = Object.freeze({
  parseConfigResult: (value: unknown, onUnknownKey: (path: string) => void = () => undefined) =>
    parseConfigResult(value, onUnknownKey),
});
