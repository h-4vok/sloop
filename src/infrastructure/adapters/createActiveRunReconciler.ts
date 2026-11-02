import type { ActiveRunReconciliation } from '../../core/ActiveRunReconciliation.js';
import type { State } from '../../dispatcher.js';
import type { SloopConfig } from '../../config.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { reconcileActiveRun } from './reconcileActiveRun.js';

type ActiveRunReconcilerOptions = Readonly<{
  client: ReturnType<typeof gitHubCommandClientFactory.create>;
  config: SloopConfig;
  root: string;
}>;

/** Creates the production check that reconciles persisted runs with GitHub and Git. */
export const activeRunReconcilerFactory = Object.freeze({
  create(options: ActiveRunReconcilerOptions): (state: State) => ActiveRunReconciliation {
    return (current) => reconcileActiveRun(options, current);
  },
});
