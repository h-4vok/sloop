import { processAdapter } from './infrastructure/process/index.js';

export { processAdapter } from './infrastructure/process/index.js';

// Preserve the original named API for callers outside infrastructure.
export const resolveExecutable = processAdapter.resolveExecutable;
export const childProcessInvocation = processAdapter.childProcessInvocation;
export const runSyncCommand = processAdapter.runSyncCommand;
