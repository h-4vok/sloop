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
    const legacy = rejectLegacyCommandMix(args);
    if (!legacy.ok) return legacy;
    const help = parseHelpCommand(args);
    if (!help.ok) return help;
    if (help.value) return result.success(help.value);
    const readOnly = parseReadOnlyArguments.parse(args);
    if (!readOnly.ok) return readOnly;
    if (readOnly.value) return result.success({ kind: 'read-only', command: readOnly.value });
    const config = parseConfigCommand(args);
    if (!config.ok) return config;
    if (config.value) return result.success(config.value);
    const dispatcher = parseDispatcherArguments.parse(args);
    return dispatcher.ok
      ? result.success({ kind: 'dispatcher', command: dispatcher.value })
      : dispatcher;
  },
});

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
}
