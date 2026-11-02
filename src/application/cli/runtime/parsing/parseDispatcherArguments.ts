import type { Result } from '../../../../core/Result.js';
import { result } from '../../../../core/Result.js';
import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';
import { parseRecoveryArguments } from './parseRecoveryArguments.js';
import { parseReviewCapArguments } from './parseReviewCapArguments.js';

type ParseResult<T> = Result<T, string>;

const singleArgumentCommands: Readonly<Record<string, DispatcherCommand>> = Object.freeze({
  '--list': { kind: 'list' },
  '--recover-lock': { kind: 'recover-lock' },
  '--reset': { kind: 'reset' },
  '--list-all-worktrees': { kind: 'list-all-worktrees' },
  '--clear-all-worktrees': { kind: 'clear-all-worktrees' },
});

const dispatcherCommandParsers = [
  (args: readonly string[]) => parseDispatcherArguments.parseStatus(args),
  (args: readonly string[]) => parseDispatcherArguments.parseSingle(args),
  (args: readonly string[]) => parseDispatcherArguments.parseIssue(args),
  (args: readonly string[]) => parseRecoveryArguments.parse(args),
] as const;

/** Parses dispatcher commands, preserving the legacy command precedence. */
export const parseDispatcherArguments = Object.freeze({
  parse(args: readonly string[]): ParseResult<DispatcherCommand> {
    if (args.length === 0) return result.success({ kind: 'workflow' });
    const command = dispatcherCommandParsers
      .map((parseCommand) => parseCommand(args))
      .find((candidate) => candidate !== undefined);
    if (command) return result.success(command);
    if (args[0] === '--resolve-review-cap' && args.length > 1)
      return parseReviewCapArguments.parse(args);
    return result.failure('mixed, duplicate, unknown, or unsupported command arguments');
  },

  parseStatus(args: readonly string[]): DispatcherCommand | undefined {
    if (
      args[0] !== '--status' ||
      (args.length !== 1 && !(args.length === 2 && args[1] === '--verbose'))
    )
      return undefined;
    return { kind: 'status', verbose: args.includes('--verbose') };
  },

  parseSingle(args: readonly string[]): DispatcherCommand | undefined {
    return args.length === 1 ? singleArgumentCommands[args[0]] : undefined;
  },

  parseIssue(args: readonly string[]): DispatcherCommand | undefined {
    if (
      args[0] !== '--link-issue' ||
      args.length !== 2 ||
      !parseRecoveryArguments.isPositiveInteger(args[1])
    )
      return undefined;
    return { kind: 'link-issue', issue: Number(args[1]) };
  },
});
