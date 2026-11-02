import type { Diagnostic, ResultEnvelope } from '../RuntimeResult.js';

type NextAction = { command?: string; description?: string; mutates?: boolean };

/** Formats an envelope for the human-readable CLI output mode. */
export function createHumanOutput(value: ResultEnvelope): string {
  const lines = [value.summary, ...value.diagnostics.map(formatDiagnostic)];
  const nextAction = readNextAction(value.result);
  if (nextAction?.command) lines.push(formatNextAction(nextAction));
  return lines.join('\n');
}

function formatDiagnostic(item: Diagnostic): string {
  return `[${item.check}] ${item.message} Remediation: ${item.remediation}`;
}

function formatNextAction(nextAction: NextAction): string {
  const description = nextAction.description ?? 'inspect the recorded state';
  const impact = nextAction.mutates ? 'mutates state' : 'read-only';
  return `Next: ${nextAction.command} (${description}; ${impact})`;
}

function readNextAction(value: unknown): NextAction | undefined {
  if (!value || typeof value !== 'object' || !('nextAction' in value)) return undefined;
  return (value as { nextAction?: NextAction }).nextAction;
}
