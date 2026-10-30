import { configRegistry } from '../configRegistry.js';
import type { ConfigDiagnostic } from '../types.js';
import { getConfigPath, setConfigPath } from './configPaths.js';

/** Parses registered values, applying defaults and collecting parser diagnostics. */
export function collectFieldDiagnostics(
  outputConfig: Record<string, unknown>,
  rawConfig: unknown,
): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];

  for (const field of configRegistry) {
    const rawValue = getConfigPath(rawConfig as Record<string, unknown>, field.path);
    const parsedValue = field.parser(
      rawValue === undefined ? field.default : rawValue,
      `$.${field.path}`,
    );

    if (parsedValue.ok) setConfigPath(outputConfig, field.path, parsedValue.value);
    else diagnostics.push(...parsedValue.error.diagnostics);
  }

  return diagnostics;
}
