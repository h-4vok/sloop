import { runConfigCommand as configCommandService } from './application/config/runConfigCommand.js';
import { runConfigWizard as configWizardService } from './application/config/runConfigWizard.js';
import { setConfigValue as configValueSetterService } from './application/config/setConfigValue.js';

export { reconcileConfig } from './application/config/runConfigCommand.js';
export type {
  ConfigReconciler,
  ConfigReconcilerWithPreflight,
  WizardIO,
} from './application/config/runConfigCommand.js';

/** Preserves the historical callable config command export. */
export const runConfigCommand = (...args: Parameters<typeof configCommandService.run>) =>
  configCommandService.run(...args);

/** Preserves the historical callable wizard export. */
export const runConfigWizard = (...args: Parameters<typeof configWizardService.run>) =>
  configWizardService.run(...args);

/** Preserves the historical callable scalar setter export. */
export const setConfigValue = (...args: Parameters<typeof configValueSetterService.run>) =>
  configValueSetterService.run(...args);
