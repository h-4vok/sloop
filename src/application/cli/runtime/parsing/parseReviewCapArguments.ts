import { result } from '../../../../core/Result.js';
import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';
import { reviewCapArgumentCollection } from './reviewCapArgumentCollection.js';
import { reviewCapArgumentValidation } from './reviewCapArgumentValidation.js';

/** Parses review-cap flags while preserving their validation and precedence rules. */
export const parseReviewCapArguments = Object.freeze({
  parse(args: readonly string[]) {
    const collected = reviewCapArgumentCollection.collect(args);
    if (!collected.ok) return collected;

    const options = reviewCapArgumentValidation.validate(collected.value);
    if (!options.ok) return options;

    return result.success({
      kind: 'resolve-review-cap',
      options: options.value,
    } as const satisfies DispatcherCommand);
  },

  collect: reviewCapArgumentCollection.collect,

  validate: reviewCapArgumentValidation.validate,

  validateCounts: reviewCapArgumentValidation.validateCounts,

  validateValues: reviewCapArgumentValidation.validateValues,

  validateCombinations: reviewCapArgumentValidation.validateCombinations,
});
