import type { Diagnostic } from '../RuntimeResult.js';

type RecoveryObservation = Readonly<{
  phase?: string;
  issue?: number;
  pullRequest?: number;
  blocker: string;
  command: string;
  description: string;
  mutates: boolean;
}>;

/** Converts persisted workflow markers into user-facing recovery hints. */
export const recoveryDiagnostics = Object.freeze({
  collect(workflow: Record<string, unknown>): RecoveryObservation[] {
    const issue = typeof workflow.issue === 'number' ? workflow.issue : undefined;
    const pullRequest = typeof workflow.pr === 'number' ? workflow.pr : undefined;
    const context = { ...(issue ? { issue } : {}), ...(pullRequest ? { pullRequest } : {}) };
    const command =
      issue && pullRequest
        ? `sloop --prepare-recovery ${issue} --pr ${pullRequest}`
        : 'sloop status --verbose';
    const observations: RecoveryObservation[] = [];
    const addObservation = (
      keys: readonly string[],
      phase: string,
      blocker: string,
      action = command,
      mutates = action.startsWith('sloop --prepare-recovery'),
    ): void => {
      const hasMarker = keys.some(
        (key) =>
          workflow[key] === true || (Array.isArray(workflow[key]) && workflow[key].length > 0),
      );
      if (!hasMarker) return;

      observations.push({
        phase,

        ...context,

        blocker,

        command: action,

        description:
          action === 'sloop status --verbose'
            ? 'Inspect the recorded state; no repair command is available without complete context.'
            : 'Prepare the recorded recovery for the issue and pull request.',

        mutates,
      });
    };

    addObservation(
      ['leaseActive', 'lease'],
      'lease',
      'Another dispatcher owns an active run lease.',
    );
    addObservation(['blockedPhase', 'phase'], 'blocked', 'The remote workflow phase is blocked.');
    addObservation(
      ['artifactMissing', 'missingArtifact'],
      'artifact',
      'The expected run artifact is absent.',
    );
    addObservation(
      ['configStale', 'configurationStale'],
      'configuration',
      'The recorded configuration fingerprint is stale.',
    );
    addObservation(
      ['checkoutDirty', 'dirtyCheckout'],
      'checkout',
      'The checkout has uncommitted changes.',
    );
    addObservation(
      ['checksFailed', 'failedChecks'],
      'checks',
      'One or more required PR checks failed.',
    );
    addObservation(
      ['prClosedUnmerged', 'closedUnmergedPr'],
      'pull request',
      'The pull request is closed but not merged.',
    );
    addObservation(
      ['schedulerDrift', 'scheduler'],
      'scheduler',
      'The scheduler configuration or heartbeat has drifted.',
    );

    return observations;
  },

  toDiagnostics(workflow: Record<string, unknown>): Diagnostic[] {
    return this.collect(workflow).map((item) => ({
      check: `recovery-${item.phase}`,

      message: `${item.blocker}${item.issue ? ` (issue #${item.issue}${item.pullRequest ? `, PR #${item.pullRequest}` : ''})` : ''}`,

      remediation: `Next: ${item.command}; ${item.mutates ? 'this mutates local recovery state' : 'read-only'}.`,

      phase: item.phase,

      ...(item.issue || item.pullRequest
        ? {
            context: {
              ...(item.issue ? { issue: item.issue } : {}),

              ...(item.pullRequest ? { pullRequest: item.pullRequest } : {}),
            },
          }
        : {}),

      nextAction: { command: item.command, description: item.description, mutates: item.mutates },

      mutates: false,
    }));
  },
});
