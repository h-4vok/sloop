import type { ConfigReconcilerKind } from './ConfigReconcilerKind.js';

/** Callback port for reconciling validated configuration with external systems. */
export type ConfigReconciler = (
  rootPath: string,
  kind: ConfigReconcilerKind,
) => void | Promise<void>;
