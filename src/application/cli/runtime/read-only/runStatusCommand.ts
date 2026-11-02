import { join } from 'node:path';
import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../../ExitCode.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import { resultOutput } from '../ResultOutput.js';
import { readOnlyCommandSupport } from './readOnlyCommandSupport.js';
import { workflowStatus } from './workflowStatus.js';

/** Executes status and emits stable workflow state and recovery diagnostics. */
export const runStatusCommand = Object.freeze({
  run(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const context = readOnlyCommandSupport.prepare(parsed, io);
    if (!context) return EXIT.preflight;
    const state = this.loadWorkflow(parsed, context.root, io);
    if (state.failure) {
      const envelope = resultOutput.createEnvelope(
        parsed.command,
        'blocked',
        'result',
        'Workflow state is unreadable.',
        null,
        [state.failure],
      );
      return resultOutput.emit(envelope, parsed.json, EXIT.blocked, io);
    }
    const envelope = workflowStatus.createResult(parsed, context, state.workflow);
    return resultOutput.emit(
      envelope,
      parsed.json,
      envelope.status === 'blocked' ? EXIT.blocked : EXIT.ok,
      io,
    );
  },

  loadWorkflow(parsed: ReadOnlyCommand, root: string, io: RuntimeIo): WorkflowState {
    const path = join(root, '.sloop', 'state.json');
    if (!shouldLoadWorkflow(parsed, path, io)) return { workflow: {} };
    try {
      const state: unknown = JSON.parse(io.readFile(path));
      if (!isWorkflowRecord(state)) throw new Error('state must be a JSON object');
      return { workflow: state as Record<string, unknown> };
    } catch {
      return {
        workflow: {},
        failure: resultOutput.createDiagnostic(
          'state',
          'The local workflow state is invalid JSON.',
          'No safe repair command is available because the state file could not be inspected.',
        ),
      };
    }
  },
});

type WorkflowState = Readonly<{ workflow: Record<string, unknown>; failure?: Diagnostic }>;

function shouldLoadWorkflow(parsed: ReadOnlyCommand, path: string, io: RuntimeIo): boolean {
  return parsed.command === 'status' && io.canRead(path);
}

function isWorkflowRecord(state: unknown): state is Record<string, unknown> {
  return Boolean(state) && typeof state === 'object' && !Array.isArray(state);
}
