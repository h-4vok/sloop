import type { Deps } from '../../dispatcher.js';
import { createAgentDependencies } from './createAgentDependencies.js';
import { createRepositoryDependencies } from './createRepositoryDependencies.js';
import type { ProductionAdapterOptions } from './ProductionAdapterOptions.js';
import type { SloopConfig } from '../../config.js';

/** Assembles the concrete dependencies used by the production dispatcher. */
export function productionDependencies(
  root: string,
  validatedConfig: SloopConfig,
  repository: string,
  options: ProductionAdapterOptions = {},
): Deps {
  const services = createRepositoryDependencies(root, validatedConfig, repository, options);
  const agents = createAgentDependencies(
    validatedConfig,
    options,
    services.workspace,
    services.client,
    root,
    services.setRunLogger,
  );
  return {
    remoteRequired: true,
    ...services.controls,
    ...services.githubProvider,
    ...services.lockStore,
    ...agents,
    remote: services.remoteAuthority,
    runContext: () => services.workspace.adapter.context!(),
    workspaceAdapter: services.workspace.adapter,
    listAllWorktrees: services.listAllWorktrees,
    clearAllWorktrees: services.clearAllWorktrees,
  };
}
