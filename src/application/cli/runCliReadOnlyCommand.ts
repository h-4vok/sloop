import type { CliCommand } from './CliCommand.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type ReadOnlyCliCommand = Extract<CliCommand, { kind: 'read-only' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

/** Executes a parsed read-only command through the runtime boundary. */
export const runCliReadOnlyCommand = Object.freeze({
  async run(
    command: ReadOnlyCliCommand,
    runtime: CliRuntime,
    context: CliExecutionContext,
  ): Promise<number> {
    return runtime.runReadOnlyCommand(command.command, context.runtimeIo);
  },
});
