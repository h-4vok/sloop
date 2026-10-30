import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';

/** Parses dispatcher recovery commands and validates positive identifiers. */
export const parseRecoveryArguments = Object.freeze({
  isPositiveInteger(value: string | undefined): boolean {
    return /^[1-9]\d*$/.test(value ?? '');
  },

  parse(args: readonly string[]): DispatcherCommand | undefined {
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
});
