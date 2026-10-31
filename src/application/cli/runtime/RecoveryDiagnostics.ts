import type { Diagnostic } from '../RuntimeResult.js';
import { recoveryObservationKinds } from './recoveryObservationKinds.js';

type RecoveryObservation = Readonly<{
  phase?: string;
  issue?: number;
  pullRequest?: number;
  blocker: string;
  command: string;
  description: string;
  mutates: boolean;
}>;

type RecoveryContext = Readonly<{
  issue?: number;
  pullRequest?: number;
  command: string;
}>;

function readWorkflowIssue(workflow: Record<string, unknown>): number | undefined {
  return typeof workflow.issue === 'number' ? workflow.issue : undefined;
}

function readWorkflowPullRequest(workflow: Record<string, unknown>): number | undefined {
  return typeof workflow.pr === 'number' ? workflow.pr : undefined;
}

function recoveryCommand(issue?: number, pullRequest?: number): string {
  if (issue && pullRequest) return `sloop --prepare-recovery ${issue} --pr ${pullRequest}`;

  return 'sloop status --verbose';
}

function createRecoveryContext(workflow: Record<string, unknown>): RecoveryContext {
  const issue = readWorkflowIssue(workflow);
  const pullRequest = readWorkflowPullRequest(workflow);

  return {
    ...(issue ? { issue } : {}),
    ...(pullRequest ? { pullRequest } : {}),
    command: recoveryCommand(issue, pullRequest),
  };
}

function createRecoveryObservation(
  workflow: Record<string, unknown>,
  context: RecoveryContext,
  kind: (typeof recoveryObservationKinds)[number],
): RecoveryObservation[] {
  const { command, ...contextValues } = context;
  const hasMarker = kind.keys.some(
    (key) => workflow[key] === true || (Array.isArray(workflow[key]) && workflow[key].length > 0),
  );
  if (!hasMarker) return [];

  return [
    {
      phase: kind.phase,
      ...contextValues,
      blocker: kind.blocker,
      command,
      description:
        command === 'sloop status --verbose'
          ? 'Inspect the recorded state; no repair command is available without complete context.'
          : 'Prepare the recorded recovery for the issue and pull request.',
      mutates: command.startsWith('sloop --prepare-recovery'),
    },
  ];
}

/** Converts persisted workflow markers into user-facing recovery hints. */
export const recoveryDiagnostics = Object.freeze({
  collect(workflow: Record<string, unknown>): RecoveryObservation[] {
    const context = createRecoveryContext(workflow);

    return recoveryObservationKinds.flatMap((kind) =>
      createRecoveryObservation(workflow, context, kind),
    );
  },

  toDiagnostics(workflow: Record<string, unknown>): Diagnostic[] {
    return this.collect(workflow).map(createDiagnosticFromRecovery);
  },
});

function createDiagnosticFromRecovery(item: RecoveryObservation): Diagnostic {
  const context = recoveryDiagnosticContext(item);
  return {
    check: `recovery-${item.phase}`,
    message: recoveryDiagnosticMessage(item),
    remediation: `Next: ${item.command}; ${item.mutates ? 'this mutates local recovery state' : 'read-only'}.`,
    phase: item.phase,
    ...(context ? { context } : {}),
    nextAction: { command: item.command, description: item.description, mutates: item.mutates },
    mutates: false,
  };
}

function recoveryDiagnosticMessage(item: RecoveryObservation): string {
  const issue = item.issue ? ` (issue #${item.issue}` : '';
  const pullRequest = item.pullRequest ? `, PR #${item.pullRequest}` : '';
  const suffix = item.issue ? `${issue}${pullRequest})` : '';
  return `${item.blocker}${suffix}`;
}

function recoveryDiagnosticContext(item: RecoveryObservation) {
  if (!item.issue && !item.pullRequest) return undefined;
  return {
    ...(item.issue ? { issue: item.issue } : {}),
    ...(item.pullRequest ? { pullRequest: item.pullRequest } : {}),
  };
}
