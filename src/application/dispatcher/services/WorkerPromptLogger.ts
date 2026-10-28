import { RunLogger } from '../../../run-log.js';
import { allowlistedPublication } from '../../../publication.js';

function logWorkerPrompt(logger: RunLogger, feedback: string): void {
  logger.write('prompt', { role: 'worker', feedback: allowlistedPublication(feedback) });
}

/** Logs allowlisted Worker prompt details. */
export const WorkerPromptLogger = {
  logWorkerPrompt,
};
