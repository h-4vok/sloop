/** Coordinates state diagnostics operations for dispatcher workflows. */
import type { Status, State } from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';

function redactDiagnostic(value: string): string {
  const credentialKey = String.raw`(?:[A-Za-z][A-Za-z0-9_-]*[-_])?(?:token|api[_-]?key|secret|password|cookie|credentials?)(?:[-_][A-Za-z0-9_-]*)?`;
  const sensitiveKey = String.raw`(?:authorization|${credentialKey})`;
  const assignedSecret = new RegExp(
    String.raw`((?:["']${sensitiveKey}["']|${sensitiveKey})\s*[:=]\s*)(?!(?:\[REDACTED\])(?=$|[\s,;\]}]))(?:Bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)`,
    'gi',
  );
  return value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@]*@/gi, '$1[REDACTED]@')
    .replace(assignedSecret, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:proxy-)?authorization\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/\b(?:ghp|github_pat|sk|xox[baprs])[-_A-Za-z0-9]+\b/gi, '[REDACTED]');
}

function normalizedError(
  phase: Status,
  diagnostic: unknown,
  state: State,
): Pick<State, 'lastError' | 'lastErrorVerbose'> {
  const verbose = redactDiagnostic(String(diagnostic ?? ''));
  const firstLine = verbose
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const context = [state.issue ? `issue #${state.issue}` : '', state.pr ? `PR #${state.pr}` : '']
    .filter(Boolean)
    .join(', ');
  const detail = firstLine
    ? ` Observed output begins: ${firstLine
        .replace(/[.!?]+/g, ',')
        .replace(/\s+/g, ' ')
        .slice(0, 400)}.`
    : ' No diagnostic output was available.';
  return {
    lastError: `The loop stopped during ${phase.replaceAll('_', ' ')}${context ? ` for ${context}` : ''}.${detail} See verbose diagnostics for the complete output.`,
    lastErrorVerbose:
      verbose || `No diagnostic output was captured during ${phase.replaceAll('_', ' ')}.`,
  };
}

export const StateDiagnostics = {
  redactDiagnostic,
  normalizedError,
};
