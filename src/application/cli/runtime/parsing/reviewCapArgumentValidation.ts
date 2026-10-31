import { result } from '../../../../core/Result.js';
import type {
  ReviewCapArguments,
  ReviewCapDraft,
  ReviewCapOptions,
  ReviewCapParseResult,
  ValidatedReviewCapFields,
} from './reviewCapTypes.js';

const repeatableOptionNames = ['--additional-rounds', '--waive-all-outstanding', '--abandon'];

function findRepeatedOption(counts: ReadonlyMap<string, number>): string | undefined {
  for (const option of repeatableOptionNames) {
    if ((counts.get(option) ?? 0) > 1) return option;
  }

  return undefined;
}

function hasInvalidAbandonCombination(
  abandon: boolean,
  waiveAllOutstanding: boolean,
  waivers: readonly string[],
  additionalRounds: number,
): boolean {
  return abandon && (waiveAllOutstanding || waivers.length > 0 || Boolean(additionalRounds));
}

function hasNoReviewCapAction(
  abandon: boolean,
  waiveAllOutstanding: boolean,
  waivers: readonly string[],
  additionalRounds: number,
): boolean {
  return !abandon && !waiveAllOutstanding && waivers.length === 0 && additionalRounds === 0;
}

function collectReviewCapDraft(parsed: ReviewCapArguments): ReviewCapParseResult<ReviewCapDraft> {
  const fieldsResult = validateReviewCapFields(parsed);
  if (!fieldsResult.ok) return fieldsResult;

  const { rounds, waivers, steer } = fieldsResult.value;

  return result.success({
    steer,
    additionalRounds: rounds === undefined ? 0 : Number(rounds),
    waivedFindingIds: waivers.flatMap((value) => value.split(',')),
    waiveAllOutstanding: (parsed.counts.get('--waive-all-outstanding') ?? 0) === 1,
    abandon: (parsed.counts.get('--abandon') ?? 0) === 1,
  });
}

function validateReviewCapFields(
  parsed: ReviewCapArguments,
): ReviewCapParseResult<ValidatedReviewCapFields> {
  const { counts, values } = parsed;
  const rounds = values.get('--additional-rounds')?.[0];
  const waivers = values.get('--waive') ?? [];
  const steer = values.get('--steer')?.[0]?.trim() ?? '';
  const validation = validateReviewCapFieldValues(counts, rounds, waivers, steer);
  if (!validation.ok) return validation;

  return result.success({ rounds, waivers, steer: validation.value });
}

function validateReviewCapFieldValues(
  counts: ReadonlyMap<string, number>,
  rounds: string | undefined,
  waivers: readonly string[],
  steer: string,
): ReviewCapParseResult<string> {
  const countValidation = validateReviewCapCounts(counts);
  if (!countValidation.ok) return countValidation;
  const valueValidation = validateReviewCapValues(rounds, waivers);
  if (!valueValidation.ok) return valueValidation;
  if (!steer) return result.failure('--resolve-review-cap requires non-empty --steer <text>');
  return result.success(steer);
}

function validateReviewCapRequest(
  parsed: ReviewCapArguments,
): ReviewCapParseResult<ReviewCapOptions> {
  const draftResult = collectReviewCapDraft(parsed);
  if (!draftResult.ok) return draftResult;

  const draft = draftResult.value;
  const combination = validateReviewCapCombinations(
    draft.abandon,
    draft.waiveAllOutstanding,
    parsed.values.get('--waive') ?? [],
    draft.additionalRounds,
  );
  if (!combination.ok) return combination;

  return result.success(draft);
}

function validateReviewCapCounts(counts: ReadonlyMap<string, number>): ReviewCapParseResult<void> {
  if ((counts.get('--steer') ?? 0) !== 1)
    return result.failure('--resolve-review-cap requires exactly one --steer <text>');

  const repeatedOption = findRepeatedOption(counts);
  if (repeatedOption) return result.failure(`${repeatedOption} cannot be repeated`);

  return result.success(undefined);
}

function validateReviewCapValues(
  rounds: string | undefined,
  waivers: readonly string[],
): ReviewCapParseResult<void> {
  if (rounds !== undefined && !/^\d+$/.test(rounds))
    return result.failure('--additional-rounds must be a non-negative integer');
  if (waivers.some((value) => !/^[QS]\d+(?:,[QS]\d+)*$/.test(value)))
    return result.failure('--waive requires comma-separated Q<n> or S<n> finding IDs');

  return result.success(undefined);
}

function validateReviewCapCombinations(
  abandon: boolean,
  waiveAllOutstanding: boolean,
  waivers: readonly string[],
  additionalRounds: number,
): ReviewCapParseResult<void> {
  if (hasInvalidAbandonCombination(abandon, waiveAllOutstanding, waivers, additionalRounds))
    return result.failure('--abandon cannot be combined with waivers or additional rounds');
  if (hasNoReviewCapAction(abandon, waiveAllOutstanding, waivers, additionalRounds))
    return result.failure(
      'choose --additional-rounds, --waive, --waive-all-outstanding, or --abandon',
    );

  return result.success(undefined);
}

/** Validates review-cap options and exposes the parser's focused validators. */
export const reviewCapArgumentValidation = Object.freeze({
  validate: validateReviewCapRequest,
  validateCounts: validateReviewCapCounts,
  validateValues: validateReviewCapValues,
  validateCombinations: validateReviewCapCombinations,
});
