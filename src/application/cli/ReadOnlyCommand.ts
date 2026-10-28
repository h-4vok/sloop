/** Parsed input for read-only repository commands. */
export type ReadOnlyCommand = Readonly<{
  command: 'status' | 'issues list' | 'doctor';
  json: boolean;
  verbose: boolean;
}>;
