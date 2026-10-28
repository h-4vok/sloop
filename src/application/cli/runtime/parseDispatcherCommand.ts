import type { DispatcherCommand } from '../../dispatcher/DispatcherCommand.js';
import type { Result } from '../../../core/Result.js';
import { commandParser } from './CommandParser.js';

/** Parses the legacy dispatcher command-line forms. */
export const parseDispatcherCommand = (
  args: readonly string[],
): Result<DispatcherCommand, string> => commandParser.parseDispatcherCommand(args);
