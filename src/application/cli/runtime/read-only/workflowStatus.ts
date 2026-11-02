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
      resultStatus(parsed.command, workflowState),
      'result',
      summary(parsed.command, workflowState, context.root),
      resultValue(parsed, context, workflow, recovery),
      recoveryDiagnostics.toDiagnostics(workflow),
      referenceNumbers(issue),
      referenceNumbers(pr),
    );
  },
});

function resultStatus(command: ReadOnlyCommand['command'], status: string): ResultStatus {
  return command === 'status' ? statusFor(status) : 'completed';
}

function resultValue(
  parsed: ReadOnlyCommand,
  context: ReadOnlyContext,
  workflow: Record<string, unknown>,
  recovery: ReturnType<typeof recoveryAction>,
) {
  return {
    repository: context.root,
    configRef: context.ref,
    workflow: details(parsed.verbose, workflow),
    ...(parsed.verbose ? { config: context.config } : {}),
    ...(recovery ? { nextAction: recovery } : {}),
  };
}

function referenceNumbers(value: number | undefined): number[] {
  return value === undefined ? [] : [value];
}

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
  if (isRecoveryStatus(status)) return createRecoveryAction(issue, pr);
  if (isBlockedStatus(status)) return createBlockedAction();
  return undefined;
}

function isRecoveryStatus(status: string): boolean {
  return ['worker_recovery_pending', 'ci_failed', 'qa_changes_requested'].includes(status);
}

function isBlockedStatus(status: string): boolean {
  return status === 'blocked' || status === 'abandoned';
}

function createRecoveryAction(issue?: number, pr?: number) {
  const hasContext = Boolean(issue && pr);
  return {
    command: hasContext ? `sloop --prepare-recovery ${issue} --pr ${pr}` : 'sloop status --verbose',
    description: hasContext
      ? 'Prepare local recovery for the recorded issue and PR.'
      : 'Inspect the recovery state; issue or PR context is unavailable.',
    mutates: hasContext,
  };
}

function createBlockedAction() {
  return {
    command: 'sloop status --verbose',
    description: 'Inspect the recorded blocker and available context.',
    mutates: false,
  };
}
