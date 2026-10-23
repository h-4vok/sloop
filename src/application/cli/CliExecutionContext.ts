import type { RuntimeIo } from '../../runtime.js';
import type { CliDependencies } from './CliDependencies.js';
import type { createHelp } from './createHelp.js';

// Shares the injected dependencies and derived runtime services across command handlers.
export type CliExecutionContext = CliDependencies &
  Readonly<{
    help: ReturnType<typeof createHelp>;
    runtimeIo: RuntimeIo;
  }>;
