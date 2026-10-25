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
    const reconcileConfig = (async (_rootPath, kind) => {
      if (!kind || kind === 'none') return;
      if (kind === 'github' || kind === 'skills') {
        try {
          const configText = readFileSync(join(_rootPath, 'sloop.config.yaml'), 'utf8');
          synchronize(_rootPath, loadConfigText(configText));
        } catch (error) {
          const synchronizationFailure = `${kind} synchronization failed: ${error instanceof Error ? error.message : String(error)}`;
          throw new Error(synchronizationFailure);
        }

        return;
      }
      const unsupportedReconciler = `No production reconciler is available for ${kind}.`;
      throw new Error(unsupportedReconciler);
    }) as ConfigReconcilerWithPreflight;

    reconcileConfig.preflight = (_rootPath, kind: ConfigReconcilerKind) => {
      if (kind && !['none', 'github', 'skills'].includes(kind))
        throw new Error(`No production reconciler is available for ${kind}.`);
    };

    return reconcileConfig;
  },
});
