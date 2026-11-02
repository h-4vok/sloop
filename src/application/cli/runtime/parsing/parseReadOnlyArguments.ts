import type { Result } from '../../../../core/Result.js';
import { result } from '../../../../core/Result.js';
import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';

type ParseResult<T> = Result<T, string>;

const readOnlyCommands = ['status', 'issues', 'doctor'] as const;

/** Parses status, issue-list, and doctor commands without changing their option rules. */
export const parseReadOnlyArguments = Object.freeze({
  parse(args: readonly string[]): ParseResult<ReadOnlyCommand | undefined> {
    const json = args.includes('--json');
    const stripped = args.filter((argument) => argument !== '--json');
    const parsedCommand = this.parseRecognized(stripped, json);
    if (parsedCommand) return parsedCommand;
    if (readOnlyCommands.includes(stripped[0] as (typeof readOnlyCommands)[number]))
      return result.failure(
        'usage: sloop status [--verbose] [--json] | sloop issues list [--json] | sloop doctor',
      );
    return result.success(undefined);
  },

  parseRecognized(
    args: readonly string[],
    json: boolean,
  ): ParseResult<ReadOnlyCommand | undefined> | undefined {
    return readOnlyCommandParsers
      .map((parseCommand) => parseCommand(args, json))
      .find((candidate) => candidate !== undefined);
  },

  parseIssuesList(
    args: readonly string[],
    json: boolean,
  ): ParseResult<ReadOnlyCommand> | undefined {
    if (args[0] !== 'issues' || args[1] !== 'list' || args.length !== 2) return undefined;
    return result.success({ command: 'issues list', json, verbose: false });
  },

  parseDoctor(args: readonly string[], json: boolean): ParseResult<ReadOnlyCommand> | undefined {
    if (args[0] !== 'doctor' || args.length !== 1 || json) return undefined;
    return result.success({ command: 'doctor', json: false, verbose: true });
  },

  parseStatus(args: readonly string[], json: boolean): ParseResult<ReadOnlyCommand> {
    const options = args.slice(1);
    if (options.some((argument) => argument !== '--verbose') || options.length > 1)
      return result.failure('status accepts only --verbose and --json');
    if (options.includes('--verbose') && !json)
      return result.failure('status --verbose requires --json');
    return result.success({ command: 'status', json, verbose: options.includes('--verbose') });
  },
});

const readOnlyCommandParsers = [
  (args: readonly string[], json: boolean) =>
    args[0] === 'status' ? parseReadOnlyArguments.parseStatus(args, json) : undefined,
  (args: readonly string[], json: boolean) => parseReadOnlyArguments.parseIssuesList(args, json),
  (args: readonly string[], json: boolean) => parseReadOnlyArguments.parseDoctor(args, json),
] as const;
