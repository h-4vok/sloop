import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import type { ExitCode } from '../ExitCode.js';
import { readOnlyCommandRunner } from './ReadOnlyCommandRunner.js';

/** Executes a status, issue-list, or doctor command. */
export const runReadOnlyCommand = (parsed: ReadOnlyCommand, providedIo?: RuntimeIo): ExitCode =>
  readOnlyCommandRunner.run(parsed, providedIo);
