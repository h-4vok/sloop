import type { RuntimeIo } from '../../runtime.js';
import type { CliModules } from './CliModules.js';
import { requireSupportedNode } from './requireSupportedNode.js';

export function checkNodeVersion(
  args: readonly string[],
  nodeVersion: string,
  runtime: NonNullable<CliModules['runtime']>,
  runtimeIo: RuntimeIo,
): number | undefined {
  try {
    requireSupportedNode(nodeVersion);
    return undefined;
  } catch {
    return runtime.emitNodeVersionFailure(args, nodeVersion, runtimeIo);
  }
}
