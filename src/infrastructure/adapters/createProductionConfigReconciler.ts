import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigReconciler } from '../../core/config/ConfigReconciler.js';
import type { ConfigReconcilerKind } from '../../core/config/ConfigReconcilerKind.js';
import { loadConfigText } from '../../config.js';
import { syncPrerequisites } from '../sync/index.js';

type SyncPrerequisites = typeof syncPrerequisites;
type ConfigReconcilerWithPreflight = ConfigReconciler & {
  preflight: (rootPath: string, kind: ConfigReconcilerKind) => void;
};

/** Creates the production reconciler for configuration changes with external effects. */
export const productionConfigReconcilerFactory = Object.freeze({
  create(
    _root: string,
    synchronize: SyncPrerequisites = syncPrerequisites,
  ): ConfigReconcilerWithPreflight {
    const reconcileConfig = (async (rootPath, kind) =>
      reconcileConfigKind(rootPath, kind, synchronize)) as ConfigReconcilerWithPreflight;

    reconcileConfig.preflight = (_rootPath, kind: ConfigReconcilerKind) => {
      if (kind && !['none', 'github', 'skills'].includes(kind))
        throw new Error(`No production reconciler is available for ${kind}.`);
    };

    return reconcileConfig;
  },
});

async function reconcileConfigKind(
  rootPath: string,
  kind: ConfigReconcilerKind,
  synchronize: SyncPrerequisites,
): Promise<void> {
  if (isNoOpReconciler(kind)) return;
  if (!supportsProductionReconciliation(kind))
    throw new Error(`No production reconciler is available for ${kind}.`);
  try {
    const configText = readFileSync(join(rootPath, 'sloop.config.yaml'), 'utf8');
    synchronize(rootPath, loadConfigText(configText));
  } catch (error) {
    throw new Error(`${kind} synchronization failed: ${errorMessage(error)}`);
  }
}

function isNoOpReconciler(kind: ConfigReconcilerKind): boolean {
  return !kind || kind === 'none';
}

function supportsProductionReconciliation(kind: ConfigReconcilerKind): boolean {
  return kind === 'github' || kind === 'skills';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
