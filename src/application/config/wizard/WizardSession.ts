import type { createInterface } from 'node:readline/promises';
import type { Logger } from '../../../core/Logger.js';
import type { ConfigFileStore } from '../../../config.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from '../configCommandTypes.js';

/** Carries mutable wizard state across its question and confirmation steps. */
export type WizardSession = {
  root: string;
  file: string;
  init: boolean;
  sync?: string;
  reconciler: ConfigReconcilerWithPreflight;
  io: WizardIO;
  logger: Logger;
  fileStore: ConfigFileStore;
  current: unknown;
  next: string;
  changed: string[];
  asked: Set<string>;
  warning: (path: string) => void;
  useColor: boolean;
  readline: ReturnType<typeof createInterface>;
};
