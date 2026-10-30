import type { ConfigDiagnostic } from '../types.js';
import { getConfigPath } from './configPaths.js';

/** Validates constraints spanning multiple already-parsed configuration fields. */
export function findCrossFieldDiagnostics(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];

  if (getConfigPath(outputConfig, 'schemaVersion') !== 1)
    diagnostics.push({
      path: '$.schemaVersion',
      message: 'unsupported schema version; expected 1',
    });

  const reviewOrder = getConfigPath(outputConfig, 'workflow.reviewOrder');
  if (Array.isArray(reviewOrder) && (reviewOrder.length !== 1 || reviewOrder[0] !== 'qa'))
    diagnostics.push({ path: '$.workflow.reviewOrder', message: 'must contain qa exactly once' });

  const roleMarkers = ['worker', 'qa'].map((role) =>
    getConfigPath(outputConfig, `github.roleMarkers.${role}`),
  );
  if (new Set(roleMarkers).size !== roleMarkers.length)
    diagnostics.push({ path: '$.github.roleMarkers', message: 'role markers must be unique' });

  const priorityLabels = getConfigPath(outputConfig, 'github.labels.priority');
  if (Array.isArray(priorityLabels) && new Set(priorityLabels).size !== priorityLabels.length)
    diagnostics.push({
      path: '$.github.labels.priority',
      message: 'priority labels must be unique',
    });

  return diagnostics;
}

/** Validates required values and minimums that depend on other config settings. */
export function findDependencyDiagnostics(
  outputConfig: Record<string, unknown>,
): ConfigDiagnostic[] {
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
  if (
    getConfigPath(outputConfig, 'schedule.enabled') === true &&
    !getConfigPath(outputConfig, 'schedule.expression')
  )
    diagnostics.push({
      path: '$.schedule.expression',
      message: 'is required when schedule.enabled is true',
    });

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
