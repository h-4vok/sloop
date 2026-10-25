import type { Diagnostic } from './Diagnostic.js';
import type { ResultStatus } from './ResultStatus.js';

/** Stable JSON result returned by machine-readable CLI commands. */
export type ResultEnvelope = Readonly<{
  command: string;
  status: ResultStatus;
  phase: 'discovery' | 'preflight' | 'result';
  summary: string;
  result: unknown;
  diagnostics: readonly Diagnostic[];
  references: Readonly<{ issues: readonly number[]; pullRequests: readonly number[] }>;
}>;
