import type { CliCommand } from '../../runtime.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type DispatcherCliCommand = Extract<CliCommand, { kind: 'dispatcher' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

export async function runCliDispatcherCommand(
  command: DispatcherCliCommand,
  runtime: CliRuntime,
  context: CliExecutionContext,
): Promise<number> {
  const dispatcher = context.modules?.dispatcher ?? (await import('../../dispatcher.js'));
  const adapters = context.modules?.adapters ?? (await import('../../adapters.js'));
  const preflight = runtime.runDispatcherPreflight(command.command, context.runtimeIo);

  if (!preflight.root || !preflight.config || !preflight.repository) {
    return preflight.code;
  }

  const dispatcherDependencies = adapters.productionDependencies(
    preflight.root,
    preflight.config,
    preflight.repository,
  );

  return dispatcher.runDispatcherCli(command.command, dispatcherDependencies);
}
