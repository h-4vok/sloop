import { resultOutput } from '../ResultOutput.js';
import type { Diagnostic } from '../../RuntimeResult.js';

/** Normalizes process output before diagnostics or parsers consume it. */
export const cleanOutput = (value: string): string => value.trim().replace(/\r/g, '');

/** Creates the stable diagnostic contract shared by preflight boundaries. */
export const createDiagnostic = (
  check: string,
  message: string,
  remediation: string,
  extra: Omit<Diagnostic, 'check' | 'message' | 'remediation'> = {},
): Diagnostic => resultOutput.createDiagnostic(check, message, remediation, extra);
