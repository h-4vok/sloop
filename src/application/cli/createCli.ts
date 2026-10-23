import { createHelp } from './createHelp.js';
import type { CliDependencies } from './CliDependencies.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import { createCliCommandHandlers } from './createCliCommandHandlers.js';
import { createRuntimeIo } from './createRuntimeIo.js';
import { runCliCommand } from './runCliCommand.js';

// Builds the CLI coordinator and its command handlers from injected dependencies.
export function createCli(dependencies: CliDependencies): Readonly<{
  runCliCommand: (args: readonly string[]) => Promise<number>;
}> {
  const context: CliExecutionContext = {
    ...dependencies,
    help: createHelp(dependencies.version),
    runtimeIo: createRuntimeIo(dependencies),
  };
  const commandHandlers = createCliCommandHandlers(context);
  const cli = {
    runCliCommand: (args: readonly string[]) => runCliCommand(args, context, commandHandlers),
  };

  return cli;
}
