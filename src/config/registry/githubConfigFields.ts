import type { ConfigValueType, FieldMetadata } from '../types.js';
import { configValueParsers } from '../parsing/configValueParsers.js';
import { argvParser } from '../parsing/agentArgvParser.js';
import { createConfigField } from './createConfigField.js';

const {
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  pathParser,
  unrestrictedStringParser,
} = configValueParsers;

/** Defines github configuration fields and their defaults. */
export const githubConfigFields = [
  createConfigField(
    'github.labels.eligible',
    'string',
    stringParser,
    'Automation Ready',
    'Label that makes an issue eligible.',
    { requiredReconciler: 'github' },
  ),
  createConfigField(
    'github.labels.claimed',
    'string',
    stringParser,
    'Automation Claimed',
    'Label applied while an issue is claimed.',
    { requiredReconciler: 'github' },
  ),
  createConfigField(
    'github.labels.blocked',
    'string',
    stringParser,
    'Automation Blocked',
    'Label applied to blocked work.',
    { requiredReconciler: 'github' },
  ),
  createConfigField(
    'github.labels.priority',
    'list',
    listParser,
    ['Priority: P0', 'Priority: P1', 'Priority: P2'],
    'Priority labels in highest-first order.',
    { requiredReconciler: 'github' },
  ),
  createConfigField(
    'github.roleMarkers.worker',
    'string',
    stringParser,
    '[Worker]',
    'Leading marker for Worker evidence.',
  ),
  createConfigField(
    'github.roleMarkers.qa',
    'string',
    stringParser,
    '[QA/SDET Review]',
    'Leading marker for QA review evidence.',
  ),
] satisfies readonly FieldMetadata[];
