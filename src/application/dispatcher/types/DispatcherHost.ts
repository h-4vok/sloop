import type { resolveExecutable, runSyncCommand } from '../../../process.js';

/** Host overrides for dispatcher commands that retain native CLI behavior. */
export type DispatcherHost = {
  resolveExecutable?: typeof resolveExecutable;
  runSyncCommand?: typeof runSyncCommand;
  platform?: NodeJS.Platform;
  comSpec?: string | undefined;
  now?: () => number;
  pid?: () => number;
};
