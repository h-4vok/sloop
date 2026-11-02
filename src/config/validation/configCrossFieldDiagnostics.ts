import type { ConfigDiagnostic } from '../types.js';
import { getConfigPath } from './configPaths.js';

/** Validates constraints spanning multiple already-parsed configuration fields. */
export function findCrossFieldDiagnostics(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic[] {
  return [
    schemaVersionDiagnostic(outputConfig),
    reviewOrderDiagnostic(outputConfig),
    roleMarkerDiagnostic(outputConfig),
    priorityLabelDiagnostic(outputConfig),
  ].filter((diagnostic): diagnostic is ConfigDiagnostic => diagnostic !== undefined);
}

function schemaVersionDiagnostic(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic | undefined {
  if (getConfigPath(outputConfig, 'schemaVersion') === 1) return undefined;
  return { path: '$.schemaVersion', message: 'unsupported schema version; expected 1' };
}

function reviewOrderDiagnostic(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic | undefined {
  const reviewOrder = getConfigPath(outputConfig, 'workflow.reviewOrder');
  if (!Array.isArray(reviewOrder) || (reviewOrder.length === 1 && reviewOrder[0] === 'qa'))
    return undefined;
  return { path: '$.workflow.reviewOrder', message: 'must contain qa exactly once' };
}

function roleMarkerDiagnostic(outputConfig: Record<string, unknown>): ConfigDiagnostic | undefined {
  const roleMarkers = ['worker', 'qa'].map((role) =>
    getConfigPath(outputConfig, `github.roleMarkers.${role}`),
  );
  if (new Set(roleMarkers).size === roleMarkers.length) return undefined;
  return { path: '$.github.roleMarkers', message: 'role markers must be unique' };
}

function priorityLabelDiagnostic(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic | undefined {
  const labels = getConfigPath(outputConfig, 'github.labels.priority');
  if (!Array.isArray(labels) || new Set(labels).size === labels.length) return undefined;
  return { path: '$.github.labels.priority', message: 'priority labels must be unique' };
}

/** Validates required values and minimums that depend on other config settings. */
export function findDependencyDiagnostics(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic[] {
  return [
    ...workspaceDependencyDiagnostics(outputConfig),
    ...scheduleDependencyDiagnostics(outputConfig),
    ...minimumDiagnostics(outputConfig),
  ];
}

function workspaceDependencyDiagnostics(outputConfig: Record<string, unknown>): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  if (
    getConfigPath(outputConfig, 'workspace.mode') === 'checkout' &&
    !getConfigPath(outputConfig, 'workspace.path')
  )
    diagnostics.push({
      path: '$.workspace.path',
      message: 'is required when workspace.mode is checkout',
    });
  if (
    getConfigPath(outputConfig, 'workspace.mode') === 'worktree' &&
    !getConfigPath(outputConfig, 'workspace.worktreeRoot')
  )
    diagnostics.push({
      path: '$.workspace.worktreeRoot',
      message: 'is required when workspace.mode is worktree',
    });
  return diagnostics;
}

function scheduleDependencyDiagnostics(outputConfig: Record<string, unknown>): ConfigDiagnostic[] {
  if (
    getConfigPath(outputConfig, 'schedule.enabled') !== true ||
    getConfigPath(outputConfig, 'schedule.expression')
  )
    return [];
  return [{ path: '$.schedule.expression', message: 'is required when schedule.enabled is true' }];
}

function minimumDiagnostics(outputConfig: Record<string, unknown>): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  for (const configPath of [
    'arbiter.reviewRounds',
    'arbiter.stagnatingAppearances',
    'arbiter.decisions',
  ]) {
    if ((getConfigPath(outputConfig, configPath) as number) < 1)
      diagnostics.push({ path: `$.${configPath}`, message: 'must be at least 1' });
  }
  return diagnostics;
}
