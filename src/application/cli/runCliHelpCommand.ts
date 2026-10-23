import type { CliExecutionContext } from './CliExecutionContext.js';

export async function runCliHelpCommand(
  command: { target: string },
  context: CliExecutionContext,
): Promise<number> {
  context.logger.log(context.help.forTarget(command.target));
  return 0;
}
