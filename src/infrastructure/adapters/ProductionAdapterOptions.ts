import type { CodexHarnessOptions } from '../../harness.js';
import type { AdapterExec } from './AdapterExec.js';

/** Optional process seams exposed by production dependency assembly. */
export type ProductionAdapterOptions = Readonly<{
  execFileSync?: AdapterExec;
  codexSpawn?: CodexHarnessOptions['spawn'];
}>;
