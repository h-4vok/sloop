import { ConfigValidationError, type ConfigDiagnostic, type SloopConfig } from './types.js';
import { configRegistry } from './configRegistry.js';
import { findCredentialDiagnostics } from './credentialDiagnostics.js';
import type { Result } from './Result.js';
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}
function getPath(target: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (plainObject(value) ? value[key] : undefined), target);
}
function allowedTree(): Record<string, unknown> {
  const tree: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const item of configRegistry) {
    const parts = item.path.split('.');
    let current = tree;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(current, part))
        current[part] = Object.create(null) as Record<string, unknown>;
      current = current[part] as Record<string, unknown>;
    }
    current[parts.at(-1)!] = true;
  }
  return tree;
}
function unknownKeys(value: unknown, allowed: unknown, path = '$'): string[] {
  if (!plainObject(value) || !plainObject(allowed)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(allowed, key)) return [childPath];
    return unknownKeys(child, allowed[key], childPath);
  });
}
function knownConfigValue(value: unknown, allowed: unknown): unknown {
  if (!plainObject(value) || !plainObject(allowed)) return value;
  const filtered: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(allowed)) {
    if (Object.hasOwn(value, key)) filtered[key] = knownConfigValue(value[key], child);
  }
  return filtered;
}
function containerShapes(
  value: Record<string, unknown>,
  allowed: Record<string, unknown>,
  path = '$',
): ConfigDiagnostic[] {
  return Object.entries(allowed).flatMap(([key, child]) => {
    if (!plainObject(child) || !(key in value)) return [];
    const childPath = `${path}.${key}`;
    if (!plainObject(value[key])) return [{ path: childPath, message: 'expected a YAML mapping' }];
    return containerShapes(value[key], child, childPath);
  });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

function collectFieldDiagnostics(
  output: Record<string, unknown>,
  value: unknown,
): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  for (const metadata of configRegistry) {
    const raw = getPath(value as Record<string, unknown>, metadata.path);
    const parsed = metadata.parser(
      raw === undefined ? metadata.default : raw,
      `$.${metadata.path}`,
    );
    if (parsed.ok) setPath(output, metadata.path, parsed.value);
    else diagnostics.push(...parsed.error.diagnostics);
  }
  return diagnostics;
}

function crossFieldDiagnostics(output: Record<string, unknown>): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  if (getPath(output, 'schemaVersion') !== 1)
    diagnostics.push({
      path: '$.schemaVersion',
      message: 'unsupported schema version; expected 1',
    });
  const order = getPath(output, 'workflow.reviewOrder');
  if (Array.isArray(order) && (order.length !== 1 || order[0] !== 'qa'))
    diagnostics.push({ path: '$.workflow.reviewOrder', message: 'must contain qa exactly once' });
  const markers = ['worker', 'qa'].map((role) => getPath(output, `github.roleMarkers.${role}`));
  if (new Set(markers).size !== markers.length)
    diagnostics.push({ path: '$.github.roleMarkers', message: 'role markers must be unique' });
  const priorities = getPath(output, 'github.labels.priority');
  if (Array.isArray(priorities) && new Set(priorities).size !== priorities.length)
    diagnostics.push({
      path: '$.github.labels.priority',
      message: 'priority labels must be unique',
    });
  return diagnostics;
}

function dependencyDiagnostics(output: Record<string, unknown>): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  if (getPath(output, 'workspace.mode') === 'checkout' && !getPath(output, 'workspace.path'))
    diagnostics.push({
      path: '$.workspace.path',
      message: 'is required when workspace.mode is checkout',
    });
  if (
    getPath(output, 'workspace.mode') === 'worktree' &&
    !getPath(output, 'workspace.worktreeRoot')
  )
    diagnostics.push({
      path: '$.workspace.worktreeRoot',
      message: 'is required when workspace.mode is worktree',
    });
  if (getPath(output, 'schedule.enabled') === true && !getPath(output, 'schedule.expression'))
    diagnostics.push({
      path: '$.schedule.expression',
      message: 'is required when schedule.enabled is true',
    });
  for (const path of [
    'arbiter.reviewRounds',
    'arbiter.stagnatingAppearances',
    'arbiter.decisions',
  ]) {
    if ((getPath(output, path) as number) < 1)
      diagnostics.push({ path: `$.${path}`, message: 'must be at least 1' });
  }
  return diagnostics;
}

function parseConfigResult(
  value: unknown,
  onUnknownKey: (path: string) => void,
): Result<SloopConfig, ConfigValidationError> {
  if (!plainObject(value))
    return {
      ok: false,
      error: new ConfigValidationError([{ path: '$', message: 'expected a YAML mapping' }]),
    };
  const allowed = allowedTree();
  for (const unknownPath of unknownKeys(value, allowed)) onUnknownKey(unknownPath);
  const diagnostics = [
    ...containerShapes(value, allowed),
    ...findCredentialDiagnostics(knownConfigValue(value, allowed)),
  ];
  const output: Record<string, unknown> = {};
  diagnostics.push(...collectFieldDiagnostics(output, value));
  diagnostics.push(...crossFieldDiagnostics(output), ...dependencyDiagnostics(output));
  if (diagnostics.length) return { ok: false, error: new ConfigValidationError(diagnostics) };
  return { ok: true, value: deepFreeze(output as SloopConfig) };
}

/** Validates raw input and returns expected configuration failures as data. */
export const configValidator = Object.freeze({
  parseConfigResult: (value: unknown, onUnknownKey: (path: string) => void = () => undefined) =>
    parseConfigResult(value, onUnknownKey),
});
