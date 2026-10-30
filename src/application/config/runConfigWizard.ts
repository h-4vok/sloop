import { stdin as input, stdout as output } from 'node:process';
import type { Logger } from '../../core/Logger.js';
import { configFileStore, configPaths, type ConfigFileStore } from '../../config.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from './configCommandTypes.js';
import {
  chooseAgentConfigurationStep,
  collectWizardField,
  confirmConfigChangesStep,
  createWizardSession,
} from './wizard/index.js';
import { failWizard } from './wizard/wizardInput.js';

/** Runs the interactive config workflow over injected IO and file boundaries. */
async function executeConfigWizard(
  root: string,
  file: string,
  scope: string | undefined,
  init: boolean,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight = async (_root, kind) => {
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
    );
  },
  io: WizardIO = { input, output },
  logger: Logger,
  fileStore: ConfigFileStore = configFileStore,
): Promise<number> {
  const sessionResult = createWizardSession(
    root,
    file,
    init,
    sync,
    reconciler,
    io,
    logger,
    fileStore,
  );
  if (!sessionResult.ok) return failWizard(sessionResult.error, logger);
  const session = sessionResult.value;
  try {
    for (const path of configPaths(scope)) {
      if (path.startsWith('agents.')) await chooseAgentConfigurationStep.run(session, path);
      else await collectWizardField.run(session, path);
    }

    return await confirmConfigChangesStep.run(session);
  } catch (error) {
    return failWizard(String(error instanceof Error ? error.message : error), logger);
  } finally {
    session.readline.close();
  }
}

/** Exposes the interactive configuration wizard service. */
export const runConfigWizard = Object.freeze({ run: executeConfigWizard });
