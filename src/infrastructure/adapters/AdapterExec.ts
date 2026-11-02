import type { AdapterExecOptions } from './AdapterExecOptions.js';

/** Injectable command boundary used by production GitHub adapters and tests. */
export type AdapterExec = (
  file: string,
  args: readonly string[],
  options: AdapterExecOptions,
) => string | Buffer | void;
