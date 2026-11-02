import { result } from '../../../../core/Result.js';
import type { ReviewCapArguments, ReviewCapParseResult } from './reviewCapTypes.js';

const valueOptions = new Set(['--steer', '--additional-rounds', '--waive']);
const booleanOptions = new Set(['--waive-all-outstanding', '--abandon']);

function isKnownReviewCapOption(option: string): boolean {
  return valueOptions.has(option) || booleanOptions.has(option);
}

function readReviewCapOptionValue(
  args: readonly string[],
  index: number,
  option: string,
): ReviewCapParseResult<string> {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return result.failure(`${option} requires a value`);

  return result.success(value);
}

function countReviewCapOption(counts: Map<string, number>, option: string): void {
  counts.set(option, (counts.get(option) ?? 0) + 1);
}

function appendReviewCapOptionValue(
  values: Map<string, string[]>,
  option: string,
  value: string,
): void {
  values.set(option, [...(values.get(option) ?? []), value]);
}

function collectReviewCapArguments(
  args: readonly string[],
): ReviewCapParseResult<ReviewCapArguments> {
  const counts = new Map<string, number>();
  const values = new Map<string, string[]>();

  for (let index = 1; index < args.length; index++) {
    const option = args[index];
    if (!isKnownReviewCapOption(option))
      return result.failure('mixed, duplicate, unknown, or unsupported command arguments');

    countReviewCapOption(counts, option);
    if (!valueOptions.has(option)) continue;

    const valueResult = readReviewCapOptionValue(args, index, option);
    if (!valueResult.ok) return valueResult;

    index++;
    appendReviewCapOptionValue(values, option, valueResult.value);
  }

  return result.success({ counts, values });
}

/** Collects review-cap flags and their values from CLI arguments. */
export const reviewCapArgumentCollection = Object.freeze({
  collect: collectReviewCapArguments,
});
