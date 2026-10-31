import type { AdapterExec } from './AdapterExec.js';

/** Supplies repository identity and execution logging to the GitHub adapter. */
export type GitHubProviderOptions = Readonly<{
  root: string;
  repository: string;
  eligibleLabel: string;
  priorityLabels: readonly string[];
  execute: AdapterExec;
  logGithub: (phase: string, operation: string, data: unknown) => void;
}>;
