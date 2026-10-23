import type { CliCommand } from '../../runtime.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type ReadOnlyCliCommand = Extract<CliCommand, { kind: 'read-only' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

export async function runCliReadOnlyCommand(
  command: ReadOnlyCliCommand,
  runtime: CliRuntime,
  context: CliExecutionContext,
): Promise<number> {
  return runtime.runReadOnlyCommand(command.command, context.runtimeIo);
}
