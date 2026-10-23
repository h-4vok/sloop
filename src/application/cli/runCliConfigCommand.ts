import type { CliCommand } from '../../runtime.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type ConfigCliCommand = Extract<CliCommand, { kind: 'config' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

export async function runCliConfigCommand(
  command: ConfigCliCommand,
  runtime: CliRuntime,
  context: CliExecutionContext,
): Promise<number> {
  const repositoryRoot = runtime.discoverRepository(context.runtimeIo);
  const configModules = context.modules?.config
    ? context.modules.config
    : {
        ...(await import('../../config-wizard.js')),
        ...(await import('../../adapters.js')),
      };

  return configModules.runConfigCommand(
    repositoryRoot,
    command.args,
    configModules.productionConfigReconciler(repositoryRoot),
    { input: context.host.stdin, output: context.host.stdout },
    context.logger,
  );
}
