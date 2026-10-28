import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliCommandHandlers } from './CliCommandHandlers.js';
import type { CliModules } from './CliModules.js';
import { checkNodeVersion } from './checkNodeVersion.js';
import { emitDispatcherFailure } from './emitDispatcherFailure.js';
import { loadCliRuntime } from './loadCliRuntime.js';
import { parseCliArguments } from './parseCliArguments.js';

type CliRuntime = NonNullable<CliModules['runtime']>;

/** Loads runtime services, validates a CLI invocation, and dispatches its command. */
export const runCliCommand = Object.freeze({
  async run(
    args: readonly string[],
    context: CliExecutionContext,
    commandHandlers: CliCommandHandlers,
  ): Promise<number> {
    const runtime: CliRuntime = await loadCliRuntime(context.modules);
    const versionFailureCode = checkNodeVersion(
      args,
      context.host.nodeVersion,
      runtime,
      context.runtimeIo,
    );

    if (versionFailureCode !== undefined) {
      return versionFailureCode;
    }

    const parseOutcome = parseCliArguments(args, runtime, context.runtimeIo);
    if ('exitCode' in parseOutcome) {
      return parseOutcome.exitCode;
    }

    try {
      return await commandHandlers.runCliCommand(parseOutcome.command, runtime);
    } catch (error) {
      return emitDispatcherFailure(error, context.logger);
    }
  },
});
