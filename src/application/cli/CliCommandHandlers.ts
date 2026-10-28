import type { CliCommand } from './CliCommand.js';
import type { CliModules } from './CliModules.js';

// Exposes the command execution boundary used by the CLI runner.
export type CliCommandHandlers = Readonly<{
  runCliCommand: (
    command: CliCommand,
    runtime: NonNullable<CliModules['runtime']>,
  ) => Promise<number>;
}>;
