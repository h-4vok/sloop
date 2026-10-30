import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../../ExitCode.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { resultOutput } from '../ResultOutput.js';
import { readOnlyCommandSupport } from './readOnlyCommandSupport.js';
import { workflowStatus } from './workflowStatus.js';

/** Executes the `doctor` read-only command after its dedicated repository checks. */
export const runRecoveryCommand = Object.freeze({
  run(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const context = readOnlyCommandSupport.prepare(parsed, io);
    if (!context) return EXIT.preflight;
    const envelope = workflowStatus.createResult(parsed, context, {});
    return resultOutput.emit(envelope, parsed.json, EXIT.ok, io);
  },
});
