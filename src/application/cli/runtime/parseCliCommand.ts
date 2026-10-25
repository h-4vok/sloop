import type { CliCommand } from '../CliCommand.js';
import type { Result } from '../../../core/Result.js';
import { commandParser } from './CommandParser.js';

/** Parses one top-level Sloop CLI command. */
export const parseCliCommand = (args: readonly string[]): Result<CliCommand, string> =>
  commandParser.parseCliCommand(args);
