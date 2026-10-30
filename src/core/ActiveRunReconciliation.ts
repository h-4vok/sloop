/** Result of reconciling persisted local and remote workflow state. */
export type ActiveRunReconciliation = Readonly<{
  outcome: 'open' | 'terminal' | 'blocked';
  reason: string;
  localSha?: string;
  remoteSha?: string;
}>;
