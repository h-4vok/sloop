/** Git operations required by the dispatcher core. */
export interface GitProvider {
  prepareWorkerBranch(issue: number): Readonly<{ branch: string; mainBaseSha: string }>;

  checkoutWorkerBranch(branch: string): void;
}
