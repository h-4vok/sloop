/** Reads a dotted config path without traversing non-mapping values. */
export function getConfigPath(target: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (isPlainObject(value) ? value[key] : undefined), target);
}

/** Writes a dotted config path into a mutable mapping. */
export function setConfigPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const pathParts = path.split('.');
  let currentTarget = target;

  for (const pathPart of pathParts.slice(0, -1))
    currentTarget = (currentTarget[pathPart] ??= {}) as Record<string, unknown>;

  currentTarget[pathParts.at(-1)!] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
