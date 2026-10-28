import type { Logger } from '../../core/Logger.js';
import type { NodeHost } from '../../infrastructure/host/NodeHost.js';
import { createNodeHost } from '../../infrastructure/host/createNodeHost.js';
import { consoleLogger } from '../../infrastructure/logging/consoleLogger.js';
import type { CliModules } from './CliModules.js';
import { createCli } from './createCli.js';

/** Starts the CLI using injected or production host services. */
export const startCli = Object.freeze({
  async start(
    args: readonly string[],
    version: string,
    nodeVersion = process.version,
    overrides: Readonly<{
      host?: NodeHost;
      logger?: Logger;
      modules?: CliModules;
    }> = {},
  ): Promise<void> {
    const cli = createCli({
      host: { ...(overrides.host ?? createNodeHost()), nodeVersion },
      logger: overrides.logger ?? consoleLogger,
      version,
      modules: overrides.modules,
    });

    process.exitCode = await cli.runCliCommand(args);
  },
});
