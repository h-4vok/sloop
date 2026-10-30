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

/** Defines repository configuration fields and their defaults. */
export const repositoryConfigFields = [
  createConfigField(
    'schemaVersion',
    'integer',
    integerParser,
    1,
    'Version of the tracked configuration contract.',
    { choices: [1] },
  ),
  createConfigField(
    'repository.remote',
    'string',
    stringParser,
    'origin',
    'Git remote used for Sloop branches.',
    {
      requiredReconciler: 'workspace',
    },
  ),
  createConfigField(
    'repository.baseBranch',
    'string',
    stringParser,
    'main',
    'Pull-request target and healthy base branch.',
    { requiredReconciler: 'github' },
  ),
  createConfigField(
    'repository.branchPrefix',
    'string',
    stringParser,
    'codex/issue-',
    'Prefix for issue work branches.',
    { requiredReconciler: 'workspace' },
  ),
  createConfigField(
    'workspace.mode',
    'enum',
    enumParser(['checkout', 'worktree'] as const),
    'checkout',
    'Workspace isolation strategy.',
    { choices: ['checkout', 'worktree'], requiredReconciler: 'workspace' },
  ),
  createConfigField(
    'workspace.path',
    'path',
    pathParser,
    '.',
    'Checkout path used in checkout mode.',
    {
      dependencies: ['workspace.mode=checkout'],

      sensitivity: 'sensitive',

      requiredReconciler: 'workspace',
    },
  ),
  createConfigField(
    'workspace.worktreeRoot',
    'path',
    pathParser,
    '.sloop/worktrees',
    'Parent directory for ephemeral worktrees.',
    {
      dependencies: ['workspace.mode=worktree'],

      sensitivity: 'sensitive',

      requiredReconciler: 'workspace',
    },
  ),
] satisfies readonly FieldMetadata[];
