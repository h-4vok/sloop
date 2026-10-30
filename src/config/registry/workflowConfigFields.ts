import { configValueParsers } from '../parsing/configValueParsers.js';
import { createConfigField } from './createConfigField.js';

const {
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  unrestrictedStringParser,
} = configValueParsers;

/** Defines workflow configuration fields and their defaults. */
export const workflowConfigFields = [
  createConfigField(
    'workflow.humanMergeWait',
    'boolean',
    booleanParser,
    true,
    'Wait for a human to merge an approved PR.',
  ),
  createConfigField(
    'workflow.reviewOrder',
    'list',
    listParser,
    ['qa'],
    'Review roles in execution order.',
    {
      choices: ['qa'],
    },
  ),
] satisfies readonly import('../types.js').FieldMetadata[];
