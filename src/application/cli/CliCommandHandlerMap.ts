import type { CliCommand } from './CliCommand.js';
import type { CliModules } from './CliModules.js';
import type { CliExecutionContext } from './CliExecutionContext.js';

type CliRuntime = NonNullable<CliModules['runtime']>;

// Maps each CLI command kind to its dedicated handler contract.
export type CliCommandHandlerMap = Readonly<{
  [Kind in CliCommand['kind']]: (
    command: Extract<CliCommand, { kind: Kind }>,
    runtime: CliRuntime,
    context: CliExecutionContext,
  ) => Promise<number>;
}>;
