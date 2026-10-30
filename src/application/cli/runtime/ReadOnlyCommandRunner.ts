import { createProductionRuntimeIo } from '../../../infrastructure/host/createProductionRuntimeIo.js';
import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../ExitCode.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import { runIssueListCommand } from './read-only/runIssueListCommand.js';
import { runRecoveryCommand } from './read-only/runRecoveryCommand.js';
import { runStatusCommand } from './read-only/runStatusCommand.js';

/** Routes read-only CLI commands to focused command handlers. */
export const readOnlyCommandRunner = Object.freeze({
  run(parsed: ReadOnlyCommand, providedIo?: RuntimeIo): ExitCode {
    const io = providedIo ?? createProductionRuntimeIo();
    if (parsed.command === 'issues list') return runIssueListCommand.run(parsed, io);
    if (parsed.command === 'doctor') return runRecoveryCommand.run(parsed, io);
    if (parsed.command === 'status') return runStatusCommand.run(parsed, io);
    return EXIT.preflight;
  },
});
