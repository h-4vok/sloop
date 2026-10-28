/** Result of checking a worker branch against its upstream and base branch. */
export type BranchReconciliation = Readonly<{
  aligned: boolean;
  diagnostic: string;
  localSha?: string;
  remoteSha?: string;
}>;
