import type { ReviewCapOptions } from './types/ReviewCapOptions.js';

/** Commands accepted by the workflow dispatcher after CLI parsing. */
export type DispatcherCommand =
  | Readonly<{ kind: 'workflow' }>
  | Readonly<{ kind: 'status'; verbose: boolean }>
  | Readonly<{ kind: 'list' }>
  | Readonly<{ kind: 'recover-lock' }>
  | Readonly<{ kind: 'reset' }>
  | Readonly<{ kind: 'prepare-recovery'; issue: number; pr?: number }>
  | Readonly<{ kind: 'resolve-review-cap'; options: ReviewCapOptions }>
  | Readonly<{ kind: 'link-issue'; issue: number }>
  | Readonly<{ kind: 'list-all-worktrees' }>
  | Readonly<{ kind: 'clear-all-worktrees' }>;
