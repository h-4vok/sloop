import { stdin as input, stdout as output } from 'node:process';
import type { ConfigReconcilerKind } from '../../core/config/ConfigReconcilerKind.js';
import { consoleLogger } from '../../infrastructure/logging/consoleLogger.js';
import { configFileStore, type ConfigFileStore } from '../../config.js';
import type { Logger } from '../../core/Logger.js';
import { routeConfigCommand } from './command/index.js';
import type {
  ConfigCommandContext,
  ConfigReconciler,
  ConfigReconcilerWithPreflight,
  WizardIO,
} from './configCommandTypes.js';

export type {
  ConfigReconciler,
  ConfigReconcilerWithPreflight,
  WizardIO,
} from './configCommandTypes.js';

/** The default fails clearly when no production reconciler adapter is installed. */
export const reconcileConfig: ConfigReconcilerWithPreflight = Object.assign(
  async (_root: string, kind: ConfigReconcilerKind) => {
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
    );
  },
  {
    preflight: (_root: string, kind: ConfigReconcilerKind) => {
      if (kind !== 'none')
        throw new Error(
          `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
        );
    },
  },
);

/** Composes the injected boundaries for configuration command routing. */
async function executeConfigCommand(
  root: string,
  args: readonly string[],
  reconciler: ConfigReconcilerWithPreflight = reconcileConfig,
  io: WizardIO = { input, output },
  logger: Logger = consoleLogger,
  fileStore: ConfigFileStore = configFileStore,
): Promise<number> {
  const command: ConfigCommandContext = { root, args, reconciler, io, logger, fileStore };

  return routeConfigCommand.run(command);
}

/** Exposes the stable config command service. */
export const runConfigCommand = Object.freeze({ run: executeConfigCommand });
