import type { Result } from '../../../../core/Result.js';
import { result } from '../../../../core/Result.js';
import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';

type ParseResult<T> = Result<T, string>;

/** Parses status, issue-list, and doctor commands without changing their option rules. */
export const parseReadOnlyArguments = Object.freeze({
  parse(args: readonly string[]): ParseResult<ReadOnlyCommand | undefined> {
    const json = args.includes('--json');
    const stripped = args.filter((argument) => argument !== '--json');
    if (stripped[0] === 'status') return this.parseStatus(stripped, json);
    if (stripped[0] === 'issues' && stripped[1] === 'list' && stripped.length === 2)
      return result.success({ command: 'issues list', json, verbose: false });
    if (stripped[0] === 'doctor' && stripped.length === 1 && !json)
      return result.success({ command: 'doctor', json: false, verbose: true });
    if (['status', 'issues', 'doctor'].includes(stripped[0] ?? ''))
      return result.failure(
        'usage: sloop status [--verbose] [--json] | sloop issues list [--json] | sloop doctor',
      );
    return result.success(undefined);
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
