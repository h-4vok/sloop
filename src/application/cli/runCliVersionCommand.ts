import type { CliExecutionContext } from './CliExecutionContext.js';

/** Emits the installed Sloop version for a parsed version command. */
export const runCliVersionCommand = Object.freeze({
  async run(_command: unknown, context: CliExecutionContext): Promise<number> {
    context.logger.log(context.version);
    return 0;
  },
});
