import { createHash } from 'node:crypto';
import { ConfigValidationError, type FieldMetadata, type SloopConfig } from './types.js';
import { configRegistry } from './configRegistry.js';
import type { Result } from './Result.js';

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPath(target: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (plainObject(value) ? value[key] : undefined), target);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}

function fingerprintValue(config: SloopConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const metadata of configRegistry) {
    setPath(
      result,
      metadata.path,
      metadata.sensitivity === 'sensitive'
        ? '<redacted>'
        : getPath(config as unknown as Record<string, unknown>, metadata.path),
    );
  }
  return result;
}

function configFingerprint(config: SloopConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(fingerprintValue(config)))
    .digest('hex');
}

function configValue(config: SloopConfig, path: string): unknown {
  return getPath(config as unknown as Record<string, unknown>, path);
}

function configPaths(prefix = ''): readonly string[] {
  return configRegistry
    .filter((field) => !prefix || field.path === prefix || field.path.startsWith(`${prefix}.`))
    .map((field) => field.path);
}

function parseConfigValueResult(
  field: FieldMetadata,
  value: string,
): Result<unknown, ConfigValidationError> {
  if (field.type === 'list' || field.type === 'argv')
    return {
      ok: false,

      error: new ConfigValidationError([
        { path: `$.${field.path}`, message: 'complex values require the interactive wizard' },
      ]),
    };
  if (field.type === 'boolean') {
    const booleanValue = value === 'true' ? true : value === 'false' ? false : value;
    return field.parser(booleanValue, `$.${field.path}`);
  }
  if (field.type === 'integer') return field.parser(Number(value), `$.${field.path}`);
  return field.parser(value, `$.${field.path}`);
}

/** Provides read-only configuration lookups and safe display fingerprints. */
export const configQueries = Object.freeze({
  configFingerprint,

  configValue,

  configPaths,

  parseConfigValueResult,
});
