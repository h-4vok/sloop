import type { CliCommand } from './CliCommand.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type DispatcherCliCommand = Extract<CliCommand, { kind: 'dispatcher' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

/** Executes a dispatcher command after repository preflight succeeds. */
export const runCliDispatcherCommand = Object.freeze({
  async run(
    command: DispatcherCliCommand,
    runtime: CliRuntime,
    context: CliExecutionContext,
  ): Promise<number> {
    const dispatcher = await loadDispatcher(context);
    const adapters = await loadAdapters(context);
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
  },
});

async function loadDispatcher(context: CliExecutionContext) {
  return context.modules?.dispatcher ?? (await import('../../dispatcher.js'));
}

async function loadAdapters(context: CliExecutionContext) {
  return context.modules?.adapters ?? (await import('../../adapters.js'));
}
