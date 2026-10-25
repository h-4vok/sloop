import type { Result } from '../../../core/Result.js';
import { result } from '../../../core/Result.js';
import type { CliCommand } from '../CliCommand.js';
import type { DispatcherCommand } from '../../dispatcher/DispatcherCommand.js';
import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';

type ParseResult<T> = Result<T, string>;
type ReviewCapArguments = Readonly<{ counts: Map<string, number>; values: Map<string, string[]> }>;

const helpTargets = new Map<string, readonly string[]>([
  ['sloop', ['--help']],
  ['status', ['status', '--help']],
  ['issues list', ['issues', 'list', '--help']],
  ['doctor', ['doctor', '--help']],
  ['--recover-lock', ['--recover-lock', '--help']],
  ['--reset', ['--reset', '--help']],
  ['--prepare-recovery', ['--prepare-recovery', '--help']],
  ['--resolve-review-cap', ['--resolve-review-cap', '--help']],
  ['--link-issue', ['--link-issue', '--help']],
]);
const singleArgumentCommands: Readonly<Record<string, DispatcherCommand>> = Object.freeze({
  '--list': { kind: 'list' },
  '--recover-lock': { kind: 'recover-lock' },
  '--reset': { kind: 'reset' },
  '--list-all-worktrees': { kind: 'list-all-worktrees' },
  '--clear-all-worktrees': { kind: 'clear-all-worktrees' },
});

/** Parses documented Sloop command forms into typed command or usage-error results. */
export const commandParser = Object.freeze({
  parseDispatcherCommand(args: readonly string[]): ParseResult<DispatcherCommand> {
    if (args.length === 0) return result.success({ kind: 'workflow' });
    const statusCommand = this.parseDispatcherStatus(args);
    if (statusCommand) return result.success(statusCommand);
    const singleCommand = this.parseSingleArgumentCommand(args);
    if (singleCommand) return result.success(singleCommand);
    const issueCommand = this.parseIssueCommand(args);
    if (issueCommand) return result.success(issueCommand);
    const recoveryCommand = this.parseRecoveryCommand(args);
    if (recoveryCommand) return result.success(recoveryCommand);
    if (args[0] === '--resolve-review-cap' && args.length > 1)
      return this.parseReviewCapCommand(args);
    return result.failure('mixed, duplicate, unknown, or unsupported command arguments');
  },
  parseDispatcherStatus(args: readonly string[]): DispatcherCommand | undefined {
    if (
      args[0] !== '--status' ||
      (args.length !== 1 && !(args.length === 2 && args[1] === '--verbose'))
    )
      return undefined;
    return { kind: 'status', verbose: args.includes('--verbose') };
  },
  parseSingleArgumentCommand(args: readonly string[]): DispatcherCommand | undefined {
    return args.length === 1 ? singleArgumentCommands[args[0]] : undefined;
  },
  parseIssueCommand(args: readonly string[]): DispatcherCommand | undefined {
    if (args[0] !== '--link-issue' || args.length !== 2 || !this.isPositiveInteger(args[1]))
      return undefined;
    return { kind: 'link-issue', issue: Number(args[1]) };
  },
  parseRecoveryCommand(args: readonly string[]): DispatcherCommand | undefined {
    const isValid =
      args[0] === '--prepare-recovery' &&
      this.isPositiveInteger(args[1]) &&
      (args.length === 2 ||
        (args.length === 4 && args[2] === '--pr' && this.isPositiveInteger(args[3])));
    return isValid
      ? {
          kind: 'prepare-recovery',
          issue: Number(args[1]),
          pr: args[3] ? Number(args[3]) : undefined,
        }
      : undefined;
  },
  isPositiveInteger(value: string | undefined): boolean {
    return /^[1-9]\d*$/.test(value ?? '');
  },
  parseReviewCapCommand(args: readonly string[]): ParseResult<DispatcherCommand> {
    const collected = this.collectReviewCapArguments(args);
    if (!collected.ok) return collected;
    const options = this.validateReviewCapArguments(collected.value);
    return options.ok
      ? result.success({ kind: 'resolve-review-cap', options: options.value })
      : options;
  },
  collectReviewCapArguments(args: readonly string[]): ParseResult<ReviewCapArguments> {
    const counts = new Map<string, number>();
    const values = new Map<string, string[]>();
    const valueOptions = new Set(['--steer', '--additional-rounds', '--waive']);
    const booleanOptions = new Set(['--waive-all-outstanding', '--abandon']);
    for (let index = 1; index < args.length; index++) {
      const option = args[index];
      if (!valueOptions.has(option) && !booleanOptions.has(option))
        return result.failure('mixed, duplicate, unknown, or unsupported command arguments');
      counts.set(option, (counts.get(option) ?? 0) + 1);
      if (valueOptions.has(option)) {
        const value = args[++index];
        if (!value || value.startsWith('--')) return result.failure(`${option} requires a value`);
        values.set(option, [...(values.get(option) ?? []), value]);
      }
    }
    return result.success({ counts, values });
  },
  validateReviewCapArguments(
    parsed: ReviewCapArguments,
  ): ParseResult<Extract<DispatcherCommand, { kind: 'resolve-review-cap' }>['options']> {
    const { counts, values } = parsed;
    if ((counts.get('--steer') ?? 0) !== 1)
      return result.failure('--resolve-review-cap requires exactly one --steer <text>');
    for (const option of ['--additional-rounds', '--waive-all-outstanding', '--abandon']) {
      if ((counts.get(option) ?? 0) > 1) return result.failure(`${option} cannot be repeated`);
    }
    const rounds = values.get('--additional-rounds')?.[0];
    if (rounds !== undefined && !/^\d+$/.test(rounds))
      return result.failure('--additional-rounds must be a non-negative integer');
    const waivers = values.get('--waive') ?? [];
    if (waivers.some((value) => !/^[QS]\d+(?:,[QS]\d+)*$/.test(value)))
      return result.failure('--waive requires comma-separated Q<n> or S<n> finding IDs');
    const steer = values.get('--steer')?.[0]?.trim() ?? '';
    if (!steer) return result.failure('--resolve-review-cap requires non-empty --steer <text>');
    const additionalRounds = rounds === undefined ? 0 : Number(rounds);
    const waiveAllOutstanding = (counts.get('--waive-all-outstanding') ?? 0) === 1;
    const abandon = (counts.get('--abandon') ?? 0) === 1;
    const combination = this.validateReviewCapCombinations(
      abandon,
      waiveAllOutstanding,
      waivers,
      additionalRounds,
    );
    if (!combination.ok) return combination;
    return result.success({
      steer,
      additionalRounds,
      waivedFindingIds: waivers.flatMap((value) => value.split(',')),
      waiveAllOutstanding,
      abandon,
    });
  },
  validateReviewCapCombinations(
    abandon: boolean,
    waiveAllOutstanding: boolean,
    waivers: readonly string[],
    additionalRounds: number,
  ): ParseResult<void> {
    if (abandon && (waiveAllOutstanding || waivers.length || additionalRounds))
      return result.failure('--abandon cannot be combined with waivers or additional rounds');
    if (!abandon && !waiveAllOutstanding && !waivers.length && additionalRounds === 0)
      return result.failure(
        'choose --additional-rounds, --waive, --waive-all-outstanding, or --abandon',
      );
    return result.success(undefined);
  },
  parseReadOnlyCommand(args: readonly string[]): ParseResult<ReadOnlyCommand | undefined> {
    const json = args.includes('--json');
    const stripped = args.filter((argument) => argument !== '--json');
    if (stripped[0] === 'status') return this.parseStatusCommand(stripped, json);
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
  parseStatusCommand(args: readonly string[], json: boolean): ParseResult<ReadOnlyCommand> {
    const options = args.slice(1);
    if (options.some((argument) => argument !== '--verbose') || options.length > 1)
      return result.failure('status accepts only --verbose and --json');
    if (options.includes('--verbose') && !json)
      return result.failure('status --verbose requires --json');
    return result.success({ command: 'status', json, verbose: options.includes('--verbose') });
  },
  parseCliCommand(args: readonly string[]): ParseResult<CliCommand> {
    if (args.length === 1 && args[0] === '--version') return result.success({ kind: 'version' });
    const legacy = this.rejectLegacyCommandMix(args);
    if (!legacy.ok) return legacy;
    const help = this.parseHelpCommand(args);
    if (!help.ok) return help;
    if (help.value) return result.success(help.value);
    const readOnly = this.parseReadOnlyCommand(args);
    if (!readOnly.ok) return readOnly;
    if (readOnly.value) return result.success({ kind: 'read-only', command: readOnly.value });
    const config = this.parseConfigCommand(args);
    if (!config.ok) return config;
    if (config.value) return result.success(config.value);
    const dispatcher = this.parseDispatcherCommand(args);
    return dispatcher.ok
      ? result.success({ kind: 'dispatcher', command: dispatcher.value })
      : dispatcher;
  },
  rejectLegacyCommandMix(args: readonly string[]): ParseResult<void> {
    if (args.includes('--list') && args.includes('--status'))
      return result.failure('mixed, duplicate, unknown, or unsupported command options');
    if (args.includes('--list'))
      return result.failure('`sloop --list` is no longer supported; use `sloop issues list`');
    if (args.includes('--status'))
      return result.failure('`sloop --status` is no longer supported; use `sloop status`');
    return result.success(undefined);
  },
  parseHelpCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
    if (!args.includes('--help')) return result.success(undefined);
    for (const [target, form] of helpTargets) {
      if (args.length === form.length && args.every((argument, index) => argument === form[index]))
        return result.success({ kind: 'help', target });
    }
    return result.failure('--help must be the only option for the requested command');
  },
  parseConfigCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
    if (args[0] !== 'config') return result.success(undefined);
    if (args[1] === 'init') {
      const options = args.slice(2);
      if (options.some((argument) => argument !== '--wizard'))
        return result.failure('usage: sloop config init [--wizard]');
      return result.success({ kind: 'config', args: ['--init', ...options] });
    }
    if (args[1] === 'install') {
      const options = args.slice(2);
      if (options.some((argument) => argument !== '--force'))
        return result.failure('usage: sloop config install [--force]');
      return result.success({ kind: 'config', args: ['--install', ...options] });
    }
    return result.success({ kind: 'config', args: args.slice(1) });
  },
});
