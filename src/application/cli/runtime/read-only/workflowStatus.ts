import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';
import type { ResultEnvelope, ResultStatus } from '../../RuntimeResult.js';
import type { ReadOnlyContext } from './readOnlyCommandSupport.js';
import { recoveryDiagnostics } from '../RecoveryDiagnostics.js';
import { resultOutput } from '../ResultOutput.js';

export const workflowStatus = Object.freeze({
  createResult(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    workflow: Record<string, unknown>,
  ): ResultEnvelope {
    const workflowState = String(workflow.status ?? 'idle');
    const issue = typeof workflow.issue === 'number' ? workflow.issue : undefined;
    const pr = typeof workflow.pr === 'number' ? workflow.pr : undefined;
    const recovery = recoveryAction(workflowState, issue, pr);
    return resultOutput.createEnvelope(
      parsed.command,
      parsed.command === 'status' ? statusFor(workflowState) : 'completed',
      'result',
      summary(parsed.command, workflowState, context.root),
      {
        repository: context.root,
        configRef: context.ref,
        workflow: details(parsed.verbose, workflow),
        ...(parsed.verbose ? { config: context.config } : {}),
        ...(recovery ? { nextAction: recovery } : {}),
      },
      recoveryDiagnostics.toDiagnostics(workflow),
      issue === undefined ? [] : [issue],
      pr === undefined ? [] : [pr],
    );
  },
});

function statusFor(status: string): ResultStatus {
  if (status === 'blocked') return 'blocked';
  if (/running|pending|review|claimed/.test(status)) return 'waiting';
  return 'idle';
}

function summary(command: ReadOnlyCommand['command'], status: string, root: string): string {
  if (command !== 'status') return 'All checks passed.';
  if (status === 'idle') return `Repository ${root} is idle.`;
  return `Repository ${root} workflow status is ${status}.`;
}

function details(verbose: boolean, workflow: Record<string, unknown>) {
  if (verbose) return workflow;
  return {
    issue: workflow.issue,
    pr: workflow.pr,
    status: workflow.status,
    lastError: workflow.lastError,
  };
}

function recoveryAction(status: string, issue?: number, pr?: number) {
  if (['worker_recovery_pending', 'ci_failed', 'qa_changes_requested'].includes(status)) {
    return {
      ...(issue && pr
        ? { command: `sloop --prepare-recovery ${issue} --pr ${pr}` }
        : { command: 'sloop status --verbose' }),
      description:
        issue && pr
          ? 'Prepare local recovery for the recorded issue and PR.'
          : 'Inspect the recovery state; issue or PR context is unavailable.',
      mutates: Boolean(issue && pr),
    };
  }
  if (status === 'blocked' || status === 'abandoned')
    return {
      command: 'sloop status --verbose',
      description: 'Inspect the recorded blocker and available context.',
      mutates: false,
    };
  return undefined;
}
