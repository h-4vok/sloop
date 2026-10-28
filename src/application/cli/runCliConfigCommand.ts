import type { CliCommand } from './CliCommand.js';
import type { CliExecutionContext } from './CliExecutionContext.js';
import type { CliModules } from './CliModules.js';

type ConfigCliCommand = Extract<CliCommand, { kind: 'config' }>;
type CliRuntime = NonNullable<CliModules['runtime']>;

/** Discovers the repository and invokes the selected configuration command. */
export const runCliConfigCommand = Object.freeze({
  async run(
    command: ConfigCliCommand,
    runtime: CliRuntime,
    context: CliExecutionContext,
  ): Promise<number> {
    const repositoryResult = runtime.discoverRepository(context.runtimeIo);
    if (!repositoryResult.ok) {
      const result = runtime.resultOutput.createEnvelope(
        'config',
        'failed',
        'discovery',
        'Repository startup failed.',
        null,
        [repositoryResult.error],
      );
      return runtime.resultOutput.emit(result, false, runtime.EXIT.preflight, context.runtimeIo);
    }
    const repositoryRoot = repositoryResult.value;
    const configModules = context.modules?.config
      ? context.modules.config
      : {
          ...(await import('../config/runConfigCommand.js')),

          ...(await import('../../adapters.js')),
        };

    return configModules.runConfigCommand.run(
      repositoryRoot,
      command.args,
      configModules.productionConfigReconciler(repositoryRoot),
      { input: context.host.stdin, output: context.host.stdout },
      context.logger,
    );
  },
});
