import type { SloopConfig } from '../../../../config.js';
import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../../ExitCode.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import { repositoryPreflight } from '../RepositoryPreflight.js';
import { resultOutput } from '../ResultOutput.js';

export type ReadOnlyContext = Readonly<{ root: string; config: SloopConfig; ref: string }>;

/** Loads shared repository context and emits the existing startup/preflight errors. */
export const readOnlyCommandSupport = Object.freeze({
  prepare(parsed: ReadOnlyCommand, io: RuntimeIo): ReadOnlyContext | undefined {
    const repositoryResult = repositoryPreflight.discoverRepository(io);
    if (!repositoryResult.ok) {
      this.emitDiscoveryFailure(parsed, repositoryResult.error, io);
      return undefined;
    }
    const configResult = repositoryPreflight.loadBaseConfig(repositoryResult.value, io);
    if (!configResult.ok) {
      this.emitDiscoveryFailure(parsed, configResult.error, io);
      return undefined;
    }
    const context = {
      root: repositoryResult.value,
      config: configResult.value.config,
      ref: configResult.value.ref,
    };
    const failures = this.checkPrerequisites(parsed, context, io);
    if (failures.length) {
      this.emitPreflightFailure(parsed, failures, io);
      return undefined;
    }
    return context;
  },

  checkPrerequisites(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    io: RuntimeIo,
  ): Diagnostic[] {
    if (parsed.command === 'doctor')
      return repositoryPreflight.doctorChecks(context.root, context.config, io);
    const commonFailures = repositoryPreflight.commonChecks(context.root, context.config, io);
    return parsed.command === 'issues list'
      ? [...commonFailures, ...repositoryPreflight.githubChecks(context.root, context.config, io)]
      : commonFailures;
  },

  emitDiscoveryFailure(parsed: ReadOnlyCommand, diagnostic: Diagnostic, io: RuntimeIo): void {
    const envelope = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'discovery',
      'Repository startup failed.',
      null,
      [diagnostic],
    );
    resultOutput.emit(envelope, parsed.json, EXIT.preflight, io);
  },

  emitPreflightFailure(
    parsed: ReadOnlyCommand,
    failures: readonly Diagnostic[],
    io: RuntimeIo,
  ): ExitCode {
    const envelope = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'preflight',
      'Preflight validation failed.',
      null,
      failures,
    );
    return resultOutput.emit(envelope, parsed.json, EXIT.preflight, io);
  },
});
