/** Repository paths supplied to dispatcher workspace workflows. */
export type RunContext = Readonly<{
  originalRepository: string;
  executionRoot: string;
}>;
