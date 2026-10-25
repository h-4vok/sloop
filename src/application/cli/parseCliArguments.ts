import type { RuntimeIo } from './RuntimeIo.js';
import type { CliModules } from './CliModules.js';

type CliParseOutcome = Readonly<
  { command: import('./CliCommand.js').CliCommand } | { exitCode: number }
>;

export function parseCliArguments(
  args: readonly string[],
  runtime: NonNullable<CliModules['runtime']>,
  runtimeIo: RuntimeIo,
): CliParseOutcome {
  const parsed = runtime.parseCliCommand(args);
  if (parsed.ok) return { command: parsed.value };

  const exitCode = runtime.emitUsageFailure(args, parsed.error, runtimeIo);
  return { exitCode };
}
