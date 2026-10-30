import type { SloopConfig } from '../../../../config.js';
import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';
import { createProductionRuntimeIo } from '../../../../infrastructure/host/createProductionRuntimeIo.js';
import { EXIT, type ExitCode } from '../../ExitCode.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import { resultOutput } from '../ResultOutput.js';
import { discoverRepository, loadRepositoryConfig } from './loadRepositoryConfig.js';
import { cleanOutput, createDiagnostic } from './checkSupport.js';
import { checkGitHubPrerequisites } from './checkGitHubPrerequisites.js';
import { checkGitHubIdentity } from './checkGitHubIdentity.js';
import { checkCorePrerequisites } from './checkCorePrerequisites.js';

/** Describes the CLI preflight result while preserving optional resolved inputs. */
export type DispatcherPreflight = Readonly<{
  code: ExitCode;
  root?: string;
  config?: SloopConfig;
  repository?: string;
}>;

/** Owns dispatcher command preflight orchestration and its observable order. */
export const dispatcherChecks = Object.freeze({
  isLocalCommand(command: DispatcherCommand): boolean {
    return ['status', 'recover-lock', 'reset', 'prepare-recovery'].includes(command.kind);
  },

  isGitHubWriteCommand(command: DispatcherCommand): boolean {
    return command.kind === 'link-issue' || command.kind === 'resolve-review-cap';
  },

  checkCommandPrerequisites(
    command: DispatcherCommand,
    root: string,
    config: SloopConfig,
    io: RuntimeIo,
  ): Diagnostic[] {
    if (this.isLocalCommand(command)) return checkCorePrerequisites.commonChecks(root, config, io);
    if (command.kind === 'list')
      return [
        ...checkCorePrerequisites.commonChecks(root, config, io),
        ...checkGitHubPrerequisites.githubChecks(root, config, io),
      ];
    if (this.isGitHubWriteCommand(command))
      return [
        ...checkCorePrerequisites.commonChecks(root, config, io),
        ...checkGitHubPrerequisites.githubChecks(root, config, io, true),
      ];

    return checkCorePrerequisites.doctorChecks(root, config, io);
  },

  commandNameForDispatcher(command: DispatcherCommand): string {
    switch (command.kind) {
      case 'workflow':
        return 'sloop';
      case 'list':
        return '--list';
      case 'recover-lock':
        return '--recover-lock';
      case 'reset':
        return '--reset';
      case 'prepare-recovery':
        return '--prepare-recovery';
      case 'resolve-review-cap':
        return '--resolve-review-cap';
      case 'link-issue':
        return '--link-issue';
      case 'list-all-worktrees':
        return '--list-all-worktrees';
      case 'clear-all-worktrees':
        return '--clear-all-worktrees';
      case 'status':
        return '--status';
    }
  },

  loadDispatcherContext(
    command: DispatcherCommand,
    io: RuntimeIo,
  ): Readonly<{ root?: string; config?: SloopConfig; result: DispatcherPreflight }> {
    const rootResult = discoverRepository(io);
    if (!rootResult.ok) return { result: this.emitDiscoveryFailure(command, rootResult.error, io) };

    const configResult = loadRepositoryConfig(rootResult.value, io);
    if (!configResult.ok)
      return { result: this.emitDiscoveryFailure(command, configResult.error, io) };

    return {
      root: rootResult.value,
      config: configResult.value.config,
      result: { code: EXIT.ok },
    };
  },

  emitDiscoveryFailure(
    command: DispatcherCommand,
    diagnostic: Diagnostic,
    io: RuntimeIo,
  ): DispatcherPreflight {
    const result = resultOutput.createEnvelope(
      this.commandNameForDispatcher(command),
      'failed',
      'discovery',
      'Repository startup failed.',
      null,
      [diagnostic],
    );

    return { code: resultOutput.emit(result, false, EXIT.preflight, io) };
  },

  emitPreflightFailure(
    command: DispatcherCommand,
    failures: readonly Diagnostic[],
    io: RuntimeIo,
  ): DispatcherPreflight {
    const result = resultOutput.createEnvelope(
      this.commandNameForDispatcher(command),
      'failed',
      'preflight',
      'Preflight validation failed.',
      null,
      failures,
    );

    return { code: resultOutput.emit(result, false, EXIT.preflight, io) };
  },

  validateRepositoryIdentity(
    command: DispatcherCommand,
    root: string,
    config: SloopConfig,
    io: RuntimeIo,
  ): DispatcherPreflight {
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    const repositoryResult = checkGitHubIdentity.githubRepository(cleanOutput(remote.stdout));
    if (!repositoryResult.ok)
      return this.emitPreflightFailure(
        command,
        [
          createDiagnostic(
            'repository-identity',
            'The configured remote is not a GitHub repository URL.',
            'Set the configured remote to the target GitHub repository URL.',
          ),
        ],
        io,
      );

    return { code: EXIT.ok, root, config, repository: repositoryResult.value };
  },

  runDispatcherPreflight(command: DispatcherCommand, providedIo?: RuntimeIo): DispatcherPreflight {
    const io = providedIo ?? createProductionRuntimeIo();
    const context = this.loadDispatcherContext(command, io);
    if (!context.root || !context.config) return context.result;

    const failures = this.checkCommandPrerequisites(command, context.root, context.config, io);
    if (failures.length) return this.emitPreflightFailure(command, failures, io);

    return this.validateRepositoryIdentity(command, context.root, context.config, io);
  },
});
