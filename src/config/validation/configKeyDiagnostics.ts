import type { ConfigDiagnostic } from '../types.js';
import { configRegistry } from '../configRegistry.js';

/** Identifies plain YAML mappings while excluding arrays and null values. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Builds the allowed key tree from the authoritative field registry. */
export function buildAllowedConfigTree(): Record<string, unknown> {
  const allowedTree: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const field of configRegistry) {
    const pathParts = field.path.split('.');
    let currentTree = allowedTree;

    for (const pathPart of pathParts.slice(0, -1)) {
      if (!Object.hasOwn(currentTree, pathPart))
        currentTree[pathPart] = Object.create(null) as Record<string, unknown>;
      currentTree = currentTree[pathPart] as Record<string, unknown>;
    }

    currentTree[pathParts.at(-1)!] = true;
  }

  return allowedTree;
}

/** Collects unknown configuration keys while preserving the observed path format. */
export function findUnknownConfigKeyPaths(
  value: unknown,
  allowedTree: unknown,
  path = '$',
): string[] {
  if (!isPlainObject(value) || !isPlainObject(allowedTree)) return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(allowedTree, key)) return [childPath];

    return findUnknownConfigKeyPaths(child, allowedTree[key], childPath);
  });
}

/** Removes unknown keys before credential scanning to avoid duplicate reports. */
export function filterKnownConfigValues(value: unknown, allowedTree: unknown): unknown {
  if (!isPlainObject(value) || !isPlainObject(allowedTree)) return value;

  const filteredConfig: Record<string, unknown> = {};
  for (const [key, childTree] of Object.entries(allowedTree)) {
    if (Object.hasOwn(value, key))
      filteredConfig[key] = filterKnownConfigValues(value[key], childTree);
  }

  return filteredConfig;
}

/** Reports mapping fields that contain scalars or sequences instead of mappings. */
export function findContainerShapeDiagnostics(
  value: Record<string, unknown>,
  allowedTree: Record<string, unknown>,
  path = '$',
): ConfigDiagnostic[] {
  return Object.entries(allowedTree).flatMap(([key, childTree]) => {
    if (!isPlainObject(childTree) || !(key in value)) return [];

    const childPath = `${path}.${key}`;
    if (!isPlainObject(value[key]))
      return [{ path: childPath, message: 'expected a YAML mapping' }];

    return findContainerShapeDiagnostics(
      value[key] as Record<string, unknown>,
      childTree,
      childPath,
    );
  });
}
