import type { Logger } from '../../core/Logger.js';

export function emitDispatcherFailure(error: unknown, logger: Logger): number {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`[sloop] ${message}`);
  return error && typeof error === 'object' && 'exitCode' in error ? (error.exitCode as number) : 2;
}
