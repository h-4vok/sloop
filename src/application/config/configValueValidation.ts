import { configPaths, getConfigField, type ConfigFileStore } from '../../config.js';

const canonicalConfigPaths = new Set([
  'github.labels.eligible',
  'github.labels.claimed',
  'github.labels.blocked',
  'github.labels.priority',
  'workflow.reviewOrder',
]);

/** Returns the first user-facing validation error for a scalar config update. */
export function configValueValidationError(
  path: string,
  sync: string | undefined,
  file: string,
  fileStore: ConfigFileStore,
): string | undefined {
  const field = getConfigField(path);
  const validations = [
    () => (!field ? `unknown path ${path}; valid paths: ${configPaths().join(', ')}` : undefined),
    () =>
      canonicalConfigPaths.has(path)
        ? `${path} is canonical and read-only in v1; see #55`
        : undefined,
    () =>
      !fileStore.exists(file) ? 'No valid sloop.config.yaml; run sloop config init' : undefined,
    () =>
      field?.type === 'list' || field?.type === 'argv'
        ? `${path}: complex values require the interactive wizard`
        : undefined,
    () =>
      field && field.requiredReconciler !== 'none' && sync === undefined
        ? `${path} affects ${field.requiredReconciler}; specify --sync or --no-sync`
        : undefined,
  ];

  for (const validate of validations) {
    const message = validate();
    if (message !== undefined) return message;
  }
  return undefined;
}
