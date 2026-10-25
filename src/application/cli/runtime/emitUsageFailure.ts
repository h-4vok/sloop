import type { RuntimeIo } from '../RuntimeIo.js';
import type { ExitCode } from '../ExitCode.js';
import { resultOutput } from './ResultOutput.js';

/** Reports invalid CLI input through the public usage-failure envelope. */
export const emitUsageFailure = (
  args: readonly string[],
  message: string,
  providedIo?: RuntimeIo,
): ExitCode => resultOutput.emitUsageFailure(args, message, providedIo);
