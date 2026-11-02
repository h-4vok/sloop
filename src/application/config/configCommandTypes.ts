import type { Readable, Writable } from 'node:stream';
import type { ConfigReconciler as CoreConfigReconciler } from '../../core/config/ConfigReconciler.js';
import type { ConfigFileStore, FieldMetadata } from '../../config.js';
import type { Logger } from '../../core/Logger.js';

export type ConfigReconciler = CoreConfigReconciler;
export type ConfigReconcilerWithPreflight = ConfigReconciler & {
  preflight?: (root: string, reconciler: FieldMetadata['requiredReconciler']) => void;
};
export type WizardIO = Readonly<{
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
  /** Enables the post-init sync prompt when running with injected interactive IO. */
  promptForSync?: boolean;
  /** Overrides terminal color detection for injected interactive IO. */
  useColor?: boolean;
}>;

/** Shares injected boundaries between config command routing and handlers. */
export type ConfigCommandContext = Readonly<{
  root: string;
  args: readonly string[];
  reconciler: ConfigReconcilerWithPreflight;
  io: WizardIO;
  logger: Logger;
  fileStore: ConfigFileStore;
}>;

export type ConfigCommandRequest = Readonly<{
  file: string;
  init: boolean;
  wizardMode: boolean;
  syncFlags: readonly string[];
  sync?: string;
  positional: readonly string[];
}>;
