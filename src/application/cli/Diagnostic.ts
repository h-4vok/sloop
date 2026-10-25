/** Structured check failure reported by preflight and read-only commands. */
export type Diagnostic = Readonly<{
  check: string;
  message: string;
  remediation: string;
  phase?: string;
  context?: Readonly<{ issue?: number; pullRequest?: number }>;
  nextAction?: Readonly<{ command?: string; description: string; mutates: boolean }>;
  mutates?: boolean;
}>;
