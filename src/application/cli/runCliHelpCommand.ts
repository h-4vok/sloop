import type { CliExecutionContext } from './CliExecutionContext.js';

/** Emits the appropriate help text for a parsed help command. */
export const runCliHelpCommand = Object.freeze({
  async run(command: { target: string }, context: CliExecutionContext): Promise<number> {
    context.logger.log(context.help.forTarget(command.target));
    return 0;
  },
});
