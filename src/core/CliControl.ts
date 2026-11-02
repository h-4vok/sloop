import type { ReviewCapOptions } from './ReviewCapOptions.js';

/** Platform commands exposed to dispatcher application services. */
export interface CliControl<Config> {
  loadConfig(): Config;

  status(verbose: boolean): unknown;

  list(): unknown;

  recoverLock(): string;

  reset(): void;

  resolveReviewCap(options: ReviewCapOptions, config: Config): void;

  linkIssue(issue: number): void;

  prepareRecovery(issue: number, pr: number | undefined, config: Config): number;
}
