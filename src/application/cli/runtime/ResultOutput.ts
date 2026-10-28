import { createProductionRuntimeIo } from '../../../infrastructure/host/createProductionRuntimeIo.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import { EXIT, type ExitCode } from '../ExitCode.js';
import type { Diagnostic, ResultEnvelope, ResultStatus } from '../RuntimeResult.js';

/** Formats command results consistently for human and JSON output. */
export const resultOutput = Object.freeze({
  createDiagnostic(
    check: string,
    message: string,
    remediation: string,
    extra: Omit<Diagnostic, 'check' | 'message' | 'remediation'> = {},
  ): Diagnostic {
    return {
      check,

      message,

      remediation,

      nextAction: {
        command: 'sloop doctor',

        description:
          'Re-run the read-only prerequisite checks; no safe repair command is available from this diagnostic.',

        mutates: false,
      },

      mutates: false,

      ...extra,
    };
  },

  createEnvelope(
    command: string,
    status: ResultStatus,
    phase: ResultEnvelope['phase'],
    summary: string,
    result: unknown = null,
    diagnostics: readonly Diagnostic[] = [],
    issues: readonly number[] = [],
    pullRequests: readonly number[] = [],
  ): ResultEnvelope {
    return {
      command,

      status,

      phase,

      summary,

      result,

      diagnostics,

      references: { issues, pullRequests },
    };
  },

  commandName(args: readonly string[]): string {
    const positional = args.filter((argument) => !argument.startsWith('--'));

    return positional.length ? positional.join(' ') : (args[0] ?? 'sloop');
  },

  emit(value: ResultEnvelope, json: boolean, code: ExitCode, io: RuntimeIo): ExitCode {
    if (json) {
      io.stdout(JSON.stringify(value, null, 2));
      return code;
    }

    const lines = [value.summary];
    for (const item of value.diagnostics) {
      lines.push(`[${item.check}] ${item.message} Remediation: ${item.remediation}`);
    }

    const nextAction = this.readNextAction(value.result);
    if (nextAction?.command) {
      lines.push(
        `Next: ${nextAction.command} (${nextAction.description ?? 'inspect the recorded state'}; ${nextAction.mutates ? 'mutates state' : 'read-only'})`,
      );
    }

    (code === EXIT.ok ? io.stdout : io.stderr)(lines.join('\n'));

    return code;
  },

  emitNodeVersionFailure(
    args: readonly string[],
    nodeVersion: string,
    providedIo?: RuntimeIo,
  ): ExitCode {
    const io = providedIo ?? createProductionRuntimeIo();
    const nodeDiagnostic = this.createDiagnostic(
      'node',
      `Sloop requires Node.js 22 or newer; current runtime is ${nodeVersion}.`,
      'Install Node.js 22 or newer.',
    );
    const result = this.createEnvelope(
      this.commandName(args),
      'failed',
      'preflight',
      'Preflight validation failed.',
      null,
      [nodeDiagnostic],
    );

    return this.emit(result, args.includes('--json'), EXIT.preflight, io);
  },

  emitUsageFailure(args: readonly string[], message: string, providedIo?: RuntimeIo): ExitCode {
    const io = providedIo ?? createProductionRuntimeIo();
    const usageDiagnostic = this.createDiagnostic(
      'usage',
      message,
      'Run `sloop --help` and use a documented command form.',
    );
    const result = this.createEnvelope(
      this.commandName(args),
      'failed',
      'preflight',
      'Command usage is invalid.',
      null,
      [usageDiagnostic],
    );

    return this.emit(result, args.includes('--json'), EXIT.preflight, io);
  },

  readNextAction(
    value: unknown,
  ): { command?: string; description?: string; mutates?: boolean } | undefined {
    if (!value || typeof value !== 'object' || !('nextAction' in value)) {
      return undefined;
    }

    return (
      value as {
        nextAction?: { command?: string; description?: string; mutates?: boolean };
      }
    ).nextAction;
  },
});
