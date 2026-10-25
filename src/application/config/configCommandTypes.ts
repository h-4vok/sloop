import type { Readable, Writable } from 'node:stream';
import type { ConfigReconciler as CoreConfigReconciler } from '../../core/config/ConfigReconciler.js';
import type { FieldMetadata } from '../../config.js';

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
