import type { Logger } from '../../core/Logger.js';
import { ExternalServiceError } from '../../core/ExternalServiceError.js';

/** Converts dispatcher and external-boundary failures into public CLI exits. */
export function emitDispatcherFailure(error: unknown, logger: Logger): number {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`[sloop] ${message}`);
  if (error instanceof ExternalServiceError) return 5;

  const exitCode = (error as { exitCode?: number } | null)?.exitCode ?? 2;

  return exitCode;
}
