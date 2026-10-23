import type { CliCommand } from '../../runtime.js';
import type { RuntimeIo } from '../../runtime.js';
import type { CliModules } from './CliModules.js';

type CliParseOutcome = Readonly<{ command: CliCommand } | { exitCode: number }>;

export function parseCliArguments(
  args: readonly string[],
  runtime: NonNullable<CliModules['runtime']>,
  runtimeIo: RuntimeIo,
): CliParseOutcome {
  try {
    return { command: runtime.parseCliCommand(args) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = runtime.emitUsageFailure(args, message, runtimeIo);

    return { exitCode };
  }
}
