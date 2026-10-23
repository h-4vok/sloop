import type { CliExecutionContext } from './CliExecutionContext.js';

export async function runCliVersionCommand(
  _command: unknown,
  context: CliExecutionContext,
): Promise<number> {
  context.logger.log(context.version);
  return 0;
}
