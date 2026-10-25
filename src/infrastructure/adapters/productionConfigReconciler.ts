import { syncPrerequisites } from '../sync/index.js';
import { productionConfigReconcilerFactory } from './createProductionConfigReconciler.js';

/** Preserves the public configuration-reconciler factory at the adapter boundary. */
export function productionConfigReconciler(
  root: string,
  synchronize: typeof syncPrerequisites = syncPrerequisites,
) {
  return productionConfigReconcilerFactory.create(root, synchronize);
}
