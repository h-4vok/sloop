import type { RuntimeIo } from '../RuntimeIo.js';
import type { ExitCode } from '../ExitCode.js';
import { resultOutput } from './ResultOutput.js';

/** Reports a supported-Node-version failure through the public CLI contract. */
export const emitNodeVersionFailure = (
  args: readonly string[],
  nodeVersion: string,
  providedIo?: RuntimeIo,
): ExitCode => resultOutput.emitNodeVersionFailure(args, nodeVersion, providedIo);
