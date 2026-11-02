import type { ConfigValueType, FieldMetadata } from '../types.js';

/** Creates one registry field with the standard defaults and guidance. */
export function createConfigField<T>(
  path: string,
  type: ConfigValueType,
  parser: FieldMetadata<T>['parser'],
  defaultValue: T,
  explanation: string,
  extra: Partial<FieldMetadata<T>> = {},
): FieldMetadata<T> {
  return Object.freeze({
    path,

    type,

    parser,

    default: defaultValue,

    explanation,

    validation: 'must parse declared type',

    choices: [],

    dependencies: [],

    sensitivity: 'public',

    requiredReconciler: 'none',

    recommendation: `Leave empty to use ${JSON.stringify(defaultValue)} as default. Change unless repository policy requires otherwise.`,

    ...extra,
  });
}
