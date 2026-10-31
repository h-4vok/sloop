import type { Result } from '../../../../core/Result.js';
import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';

export type ReviewCapParseResult<T> = Result<T, string>;

export type ReviewCapDraft = Readonly<{
  steer: string;
  additionalRounds: number;
  waivedFindingIds: string[];
  waiveAllOutstanding: boolean;
  abandon: boolean;
}>;

export type ValidatedReviewCapFields = Readonly<{
  rounds?: string;
  waivers: readonly string[];
  steer: string;
}>;

export type ReviewCapArguments = Readonly<{
  counts: Map<string, number>;
  values: Map<string, string[]>;
}>;

export type ReviewCapOptions = Extract<
  DispatcherCommand,
  { kind: 'resolve-review-cap' }
>['options'];
