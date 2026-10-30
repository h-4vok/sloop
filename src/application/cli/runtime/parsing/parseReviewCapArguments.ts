import type { Result } from '../../../../core/Result.js';
import { result } from '../../../../core/Result.js';
import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';

type ParseResult<T> = Result<T, string>;
type ReviewCapArguments = Readonly<{ counts: Map<string, number>; values: Map<string, string[]> }>;
type ReviewCapOptions = Extract<DispatcherCommand, { kind: 'resolve-review-cap' }>['options'];

/** Parses review-cap flags while preserving their validation and precedence rules. */
export const parseReviewCapArguments = Object.freeze({
  parse(args: readonly string[]): ParseResult<DispatcherCommand> {
    const collected = this.collect(args);
    if (!collected.ok) return collected;

    const options = this.validate(collected.value);
    return options.ok
      ? result.success({ kind: 'resolve-review-cap', options: options.value })
      : options;
  },

  collect(args: readonly string[]): ParseResult<ReviewCapArguments> {
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

  validate(parsed: ReviewCapArguments): ParseResult<ReviewCapOptions> {
    const { counts, values } = parsed;
    const rounds = values.get('--additional-rounds')?.[0];
    const waivers = values.get('--waive') ?? [];
    const countValidation = this.validateCounts(counts);
    if (!countValidation.ok) return countValidation;

    const valueValidation = this.validateValues(rounds, waivers);
    if (!valueValidation.ok) return valueValidation;

    const steer = values.get('--steer')?.[0]?.trim() ?? '';
    if (!steer) return result.failure('--resolve-review-cap requires non-empty --steer <text>');

    const additionalRounds = rounds === undefined ? 0 : Number(rounds);
    const waiveAllOutstanding = (counts.get('--waive-all-outstanding') ?? 0) === 1;
    const abandon = (counts.get('--abandon') ?? 0) === 1;
    const combination = this.validateCombinations(
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

  validateCounts(counts: ReadonlyMap<string, number>): ParseResult<void> {
    if ((counts.get('--steer') ?? 0) !== 1)
      return result.failure('--resolve-review-cap requires exactly one --steer <text>');

    for (const option of ['--additional-rounds', '--waive-all-outstanding', '--abandon']) {
      if ((counts.get(option) ?? 0) > 1) return result.failure(`${option} cannot be repeated`);
    }

    return result.success(undefined);
  },

  validateValues(rounds: string | undefined, waivers: readonly string[]): ParseResult<void> {
    if (rounds !== undefined && !/^\d+$/.test(rounds))
      return result.failure('--additional-rounds must be a non-negative integer');
    if (waivers.some((value) => !/^[QS]\d+(?:,[QS]\d+)*$/.test(value)))
      return result.failure('--waive requires comma-separated Q<n> or S<n> finding IDs');

    return result.success(undefined);
  },

  validateCombinations(
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
});
