import type { CliCommand } from '../../runtime.js';
import type { CliCommandHandlerMap } from './CliCommandHandlerMap.js';
import type { CliCommandHandlers } from './CliCommandHandlers.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';
import { runCliConfigCommand } from './runCliConfigCommand.js';
import { runCliDispatcherCommand } from './runCliDispatcherCommand.js';
import { runCliHelpCommand } from './runCliHelpCommand.js';
import { runCliReadOnlyCommand } from './runCliReadOnlyCommand.js';
import { runCliVersionCommand } from './runCliVersionCommand.js';

// Narrows the optional module type to the runtime required after CLI initialization.
type CliRuntime = NonNullable<CliModules['runtime']>;

// Creates the command routing object bound to the shared CLI execution context.
export function createCliCommandHandlers(context: CliExecutionContext): CliCommandHandlers {
  const commandHandlerMap: CliCommandHandlerMap = {
    help: (command) => runCliHelpCommand(command, context),
    version: (command) => runCliVersionCommand(command, context),
    'read-only': (command, runtime) => runCliReadOnlyCommand(command, runtime, context),
    config: (command, runtime) => runCliConfigCommand(command, runtime, context),
    dispatcher: (command, runtime) => runCliDispatcherCommand(command, runtime, context),
  };

  const runCliCommand = (command: CliCommand, runtime: CliRuntime) =>
    commandHandlerMap[command.kind](command as never, runtime, context);

  return { runCliCommand };
}
