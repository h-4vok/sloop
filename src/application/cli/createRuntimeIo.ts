import type { RuntimeIo } from '../../runtime.js';
import type { CliDependencies } from './CliDependencies.js';

export function createRuntimeIo(dependencies: CliDependencies): RuntimeIo {
  const runtimeIo: RuntimeIo = {
    cwd: dependencies.host.cwd,
    platform: dependencies.host.platform,
    nodeVersion: dependencies.host.nodeVersion,
    run: dependencies.host.run,
    readFile: dependencies.host.readFile,
    stdout: dependencies.logger.log,
    stderr: dependencies.logger.error,
  };

  return runtimeIo;
}
