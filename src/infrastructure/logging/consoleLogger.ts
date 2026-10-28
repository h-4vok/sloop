import type { Logger } from '../../core/Logger.js';

// Provides the production logger by routing application messages to the console.
export const consoleLogger: Logger = {
  log: (message) => console.log(message),

  error: (message) => console.error(message),
};
