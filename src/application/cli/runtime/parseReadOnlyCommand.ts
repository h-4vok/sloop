import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';
import type { Result } from '../../../core/Result.js';
import { commandParser } from './CommandParser.js';

/** Parses status, issue-list, and doctor command options. */
export const parseReadOnlyCommand = (
  args: readonly string[],
): Result<ReadOnlyCommand | undefined, string> => commandParser.parseReadOnlyCommand(args);
