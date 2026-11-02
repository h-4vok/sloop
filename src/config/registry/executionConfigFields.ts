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

/** Defines Sloop execution and operations configuration fields. */
export const executionConfigFields = [
  createConfigField(
    'skills.scope',
    'enum',
    enumParser(['repository', 'user'] as const),
    'repository',
    'Installation scope for required skills.',
    { choices: ['repository', 'user'], requiredReconciler: 'skills' },
  ),
  createConfigField(
    'skills.required',
    'list',
    listParser,
    ['product-lead', 'sloop-worker', 'sloop-qa'],
    'Required Sloop skill names.',
    { requiredReconciler: 'skills' },
  ),
  createConfigField(
    'health.enabled',
    'boolean',
    booleanParser,
    true,
    'Whether base health gates new work.',
  ),
  createConfigField(
    'health.command',
    'argv',
    argvParser,
    ['gh', 'run', 'list', '--branch', 'main'],
    'Health probe argv; never evaluated by a shell.',
    { dependencies: ['health.enabled=true'] },
  ),
  createConfigField('health.timeout', 'duration', durationParser, 60_000, 'Health probe timeout.', {
    dependencies: ['health.enabled=true'],
  }),
  createConfigField(
    'loop.interval',
    'duration',
    durationParser,
    300_000,
    'Delay between foreground-loop polls.',
  ),
  createConfigField(
    'loop.taskName',
    'string',
    stringParser,
    'Sloop',
    'Human-readable scheduled task name.',
    {
      requiredReconciler: 'scheduler',
    },
  ),
  createConfigField(
    'schedule.enabled',
    'boolean',
    booleanParser,
    false,
    'Whether scheduler reconciliation is requested.',
    { requiredReconciler: 'scheduler' },
  ),
  createConfigField(
    'schedule.expression',
    'string',
    unrestrictedStringParser,
    '',
    'Platform scheduler expression.',
    { dependencies: ['schedule.enabled=true'], requiredReconciler: 'scheduler' },
  ),
  createConfigField(
    'logging.directory',
    'path',
    pathParser,
    '.sloop/logs',
    'Directory for sensitive local run logs.',
    { sensitivity: 'sensitive' },
  ),
  createConfigField(
    'logging.retention',
    'duration',
    durationParser,
    2_592_000_000,
    'Log retention duration.',
  ),
  createConfigField(
    'logging.roleInvocation',
    'boolean',
    booleanParser,
    true,
    'Record redacted role invocation metadata.',
  ),
  createConfigField(
    'arbiter.reviewRounds',
    'integer',
    integerParser,
    3,
    'Maximum review rounds before Arbiter intervention.',
  ),
  createConfigField(
    'arbiter.stagnatingAppearances',
    'integer',
    integerParser,
    2,
    'Repeated appearances before a finding is stagnating.',
  ),
  createConfigField(
    'arbiter.decisions',
    'integer',
    integerParser,
    2,
    'Maximum Arbiter decisions for one issue.',
  ),
] satisfies readonly import('../types.js').FieldMetadata[];
