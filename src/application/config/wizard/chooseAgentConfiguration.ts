import type { WizardSession } from './WizardSession.js';
import { collectWizardField } from './collectConfigField.js';

/** Collects one harness, model, or sandbox choice in the registry's original order. */
async function chooseAgentConfiguration(session: WizardSession, path: string): Promise<void> {
  if (!path.startsWith('agents.')) throw new Error(`Not an agent configuration path: ${path}`);

  await collectWizardField.run(session, path);
}

/** Exposes the agent configuration choice step. */
export const chooseAgentConfigurationStep = Object.freeze({ run: chooseAgentConfiguration });
