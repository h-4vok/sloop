import type { Logger } from '../../core/Logger.js';
import type { NodeHost } from '../../infrastructure/host/NodeHost.js';
import type { CliModules } from './CliModules.js';

// Defines the host services and dynamically loaded modules required by the CLI.
export type CliDependencies = Readonly<{
  host: NodeHost;
  logger: Logger;
  version: string;
  modules?: CliModules;
}>;
