import type { Result } from '../../../core/Result.js';
import { result } from '../../../core/Result.js';
import type { CliCommand } from '../CliCommand.js';
import type { DispatcherCommand } from '../../dispatcher/DispatcherCommand.js';
import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';
import { parseDispatcherArguments } from './parsing/parseDispatcherArguments.js';
import { parseReadOnlyArguments } from './parsing/parseReadOnlyArguments.js';

type ParseResult<T> = Result<T, string>;

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

const configSubcommands: Readonly<
  Record<string, (options: readonly string[]) => ParseResult<CliCommand | undefined>>
> = {
  init: parseConfigInit,
  install: parseConfigInstall,
};

/** Composes domain parsers and preserves the CLI's public command contract. */
export const commandParser = Object.freeze({
  parseDispatcherCommand(args: readonly string[]): ParseResult<DispatcherCommand> {
    return parseDispatcherArguments.parse(args);
  },

  parseReadOnlyCommand(args: readonly string[]): ParseResult<ReadOnlyCommand | undefined> {
    return parseReadOnlyArguments.parse(args);
  },

  parseCliCommand(args: readonly string[]): ParseResult<CliCommand> {
    if (args.length === 1 && args[0] === '--version') return result.success({ kind: 'version' });

    return parseCliCommandStages(args);
  },
});

function parseCliCommandStages(args: readonly string[]): ParseResult<CliCommand> {
  const stages = [
    parseLegacyCommand,
    parseHelpCommand,
    parseReadOnlyCliCommand,
    parseConfigCommand,
  ];
  for (const parseStage of stages) {
    const parsedStage = parseStage(args);
    if (!parsedStage.ok) return parsedStage;
    if (parsedStage.value) return result.success(parsedStage.value);
  }

  const dispatcher = parseDispatcherArguments.parse(args);
  if (!dispatcher.ok) return dispatcher;

  return result.success({ kind: 'dispatcher', command: dispatcher.value });
}

function parseLegacyCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
  const legacyResult = rejectLegacyCommandMix(args);
  if (!legacyResult.ok) return legacyResult;

  return result.success(undefined);
}

function parseReadOnlyCliCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
  const readOnlyResult = parseReadOnlyArguments.parse(args);
  if (!readOnlyResult.ok) return readOnlyResult;
  if (!readOnlyResult.value) return result.success(undefined);

  return result.success({ kind: 'read-only', command: readOnlyResult.value });
}

function rejectLegacyCommandMix(args: readonly string[]): ParseResult<void> {
  if (args.includes('--list') && args.includes('--status'))
    return result.failure('mixed, duplicate, unknown, or unsupported command options');
  if (args.includes('--list'))
    return result.failure('`sloop --list` is no longer supported; use `sloop issues list`');
  if (args.includes('--status'))
    return result.failure('`sloop --status` is no longer supported; use `sloop status`');
  return result.success(undefined);
}

function parseHelpCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
  if (!args.includes('--help')) return result.success(undefined);
  for (const [target, form] of helpTargets) {
    if (args.length === form.length && args.every((argument, index) => argument === form[index]))
      return result.success({ kind: 'help', target });
  }
  return result.failure('--help must be the only option for the requested command');
}

function parseConfigCommand(args: readonly string[]): ParseResult<CliCommand | undefined> {
  if (args[0] !== 'config') return result.success(undefined);

  const parseSubcommand = configSubcommands[args[1]];
  if (parseSubcommand) return parseSubcommand(args.slice(2));

  return result.success({ kind: 'config', args: args.slice(1) });
}

function parseConfigInit(options: readonly string[]): ParseResult<CliCommand | undefined> {
  if (options.some((argument) => argument !== '--wizard'))
    return result.failure('usage: sloop config init [--wizard]');

  return result.success({ kind: 'config', args: ['--init', ...options] });
}

function parseConfigInstall(options: readonly string[]): ParseResult<CliCommand | undefined> {
  if (options.some((argument) => argument !== '--force'))
    return result.failure('usage: sloop config install [--force]');

  return result.success({ kind: 'config', args: ['--install', ...options] });
}
