import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';

/** Parses dispatcher recovery commands and validates positive identifiers. */
export const parseRecoveryArguments = Object.freeze({
  isPositiveInteger(value: string | undefined): boolean {
    return /^[1-9]\d*$/.test(value ?? '');
  },

  parse(args: readonly string[]): DispatcherCommand | undefined {
    if (!this.hasValidRecoveryIssue(args)) return undefined;
    if (args.length !== 2 && !this.hasValidPullRequest(args)) return undefined;

    return {
      kind: 'prepare-recovery',
      issue: Number(args[1]),
      pr: args.length === 4 ? Number(args[3]) : undefined,
    };
  },

  hasValidRecoveryIssue(args: readonly string[]): boolean {
    return args[0] === '--prepare-recovery' && this.isPositiveInteger(args[1]);
  },

  hasValidPullRequest(args: readonly string[]): boolean {
    return args.length === 4 && args[2] === '--pr' && this.isPositiveInteger(args[3]);
  },
});
