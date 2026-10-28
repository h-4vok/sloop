import type { RuntimeIo } from './RuntimeIo.js';
import type { CliDependencies } from './CliDependencies.js';

export function createRuntimeIo(dependencies: CliDependencies): RuntimeIo {
  const runtimeIo: RuntimeIo = {
    cwd: dependencies.host.cwd,

    platform: dependencies.host.platform,

    nodeVersion: dependencies.host.nodeVersion,

    homeDirectory: dependencies.host.homeDirectory,

    run: dependencies.host.run,

    readFile: dependencies.host.readFile,

    canRead: dependencies.host.canRead,

    stdout: dependencies.logger.log,

    stderr: dependencies.logger.error,
  };

  return runtimeIo;
}
