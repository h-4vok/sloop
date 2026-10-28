/** Options passed to the injected GitHub CLI executor. */
export type AdapterExecOptions = Readonly<{
  cwd: string;
  encoding?: BufferEncoding;
  stdio?: 'inherit' | 'pipe';
}>;
