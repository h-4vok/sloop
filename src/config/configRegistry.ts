import type { ConfigValueType, FieldMetadata } from './types.js';
import { configValueParsers } from './valueParsers.js';

const {
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  argvParser,
  pathParser,
  unrestrictedStringParser,
} = configValueParsers;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
function field<T>(
  metadata: Omit<
    FieldMetadata<T>,
    'validation' | 'choices' | 'dependencies' | 'sensitivity' | 'requiredReconciler'
  > &
    Partial<
      Pick<
        FieldMetadata<T>,
        'validation' | 'choices' | 'dependencies' | 'sensitivity' | 'requiredReconciler'
      >
    >,
): FieldMetadata<T> {
  return Object.freeze({
    validation: 'must parse as the declared type',

    choices: [],

    dependencies: [],

    sensitivity: 'public',

    requiredReconciler: 'none',

    ...metadata,
  });
}

const f = <T>(
  path: string,
  type: ConfigValueType,
  parser: FieldMetadata<T>['parser'],
  defaultValue: T,
  explanation: string,
  extra: Partial<FieldMetadata<T>> = {},
) =>
  field<T>({
    path,

    type,

    parser,

    default: defaultValue,

    explanation,

    recommendation: `Leave empty to use ${JSON.stringify(defaultValue)} as default. Change unless repository policy requires otherwise.`,

    ...extra,
  });

/** Provides the single authoritative schema and defaults for Sloop configuration. */
export const configRegistry = deepFreeze([
  f(
    'schemaVersion',
    'integer',
    integerParser,
    1,
    'Version of the tracked configuration contract.',
    { choices: [1] },
  ),
  f('repository.remote', 'string', stringParser, 'origin', 'Git remote used for Sloop branches.', {
    requiredReconciler: 'workspace',
  }),
  f(
    'repository.baseBranch',
    'string',
    stringParser,
    'main',
    'Pull-request target and healthy base branch.',
    { requiredReconciler: 'github' },
  ),
  f(
    'repository.branchPrefix',
    'string',
    stringParser,
    'codex/issue-',
    'Prefix for issue work branches.',
    { requiredReconciler: 'workspace' },
  ),
  f(
    'workspace.mode',
    'enum',
    enumParser(['checkout', 'worktree'] as const),
    'checkout',
    'Workspace isolation strategy.',
    { choices: ['checkout', 'worktree'], requiredReconciler: 'workspace' },
  ),
  f('workspace.path', 'path', pathParser, '.', 'Checkout path used in checkout mode.', {
    dependencies: ['workspace.mode=checkout'],

    sensitivity: 'sensitive',

    requiredReconciler: 'workspace',
  }),
  f(
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
  f(
    'github.labels.eligible',
    'string',
    stringParser,
    'Automation Ready',
    'Label that makes an issue eligible.',
    { requiredReconciler: 'github' },
  ),
  f(
    'github.labels.claimed',
    'string',
    stringParser,
    'Automation Claimed',
    'Label applied while an issue is claimed.',
    { requiredReconciler: 'github' },
  ),
  f(
    'github.labels.blocked',
    'string',
    stringParser,
    'Automation Blocked',
    'Label applied to blocked work.',
    { requiredReconciler: 'github' },
  ),
  f(
    'github.labels.priority',
    'list',
    listParser,
    ['Priority: P0', 'Priority: P1', 'Priority: P2'],
    'Priority labels in highest-first order.',
    { requiredReconciler: 'github' },
  ),
  f(
    'github.roleMarkers.worker',
    'string',
    stringParser,
    '[Worker]',
    'Leading marker for Worker evidence.',
  ),
  f(
    'github.roleMarkers.qa',
    'string',
    stringParser,
    '[QA/SDET Review]',
    'Leading marker for QA review evidence.',
  ),
  f(
    'workflow.humanMergeWait',
    'boolean',
    booleanParser,
    true,
    'Wait for a human to merge an approved PR.',
  ),
  f('workflow.reviewOrder', 'list', listParser, ['qa'], 'Review roles in execution order.', {
    choices: ['qa'],
  }),
  ...(['worker', 'qa', 'arbiter'] as const).flatMap((role) => [
    f(
      `agents.${role}.harness`,
      'enum',
      enumParser(['codex'] as const),
      'codex',
      `${role} harness adapter.`,
    ),
    f(`agents.${role}.model`, 'string', stringParser, 'gpt-5.6-luna', `${role} model.`),
    f(
      `agents.${role}.sandbox`,
      'enum',
      enumParser(['read-only', 'workspace-write', 'danger-full-access'] as const),
      role === 'arbiter' ? 'read-only' : 'workspace-write',
      `${role} sandbox policy.`,
      { choices: ['read-only', 'workspace-write', 'danger-full-access'] },
    ),
    f(
      `agents.${role}.reasoningEffort`,
      'enum',
      enumParser(['minimal', 'low', 'medium', 'high', 'xhigh'] as const),
      'low',
      `${role} reasoning effort.`,
    ),
    f(
      `agents.${role}.timeout`,
      'duration',
      durationParser,
      600_000,
      `${role} runner timeout in milliseconds.`,
    ),
    f(`agents.${role}.retries`, 'integer', integerParser, 0, `${role} runner retry count.`),
  ]),
  f(
    'skills.scope',
    'enum',
    enumParser(['repository', 'user'] as const),
    'repository',
    'Installation scope for required skills.',
    { choices: ['repository', 'user'], requiredReconciler: 'skills' },
  ),
  f(
    'skills.required',
    'list',
    listParser,
    ['product-lead', 'sloop-worker', 'sloop-qa'],
    'Required Sloop skill names.',
    { requiredReconciler: 'skills' },
  ),
  f('health.enabled', 'boolean', booleanParser, true, 'Whether base health gates new work.'),
  f(
    'health.command',
    'argv',
    argvParser,
    ['gh', 'run', 'list', '--branch', 'main'],
    'Health probe argv; never evaluated by a shell.',
    { dependencies: ['health.enabled=true'] },
  ),
  f('health.timeout', 'duration', durationParser, 60_000, 'Health probe timeout.', {
    dependencies: ['health.enabled=true'],
  }),
  f('loop.interval', 'duration', durationParser, 300_000, 'Delay between foreground-loop polls.'),
  f('loop.taskName', 'string', stringParser, 'Sloop', 'Human-readable scheduled task name.', {
    requiredReconciler: 'scheduler',
  }),
  f(
    'schedule.enabled',
    'boolean',
    booleanParser,
    false,
    'Whether scheduler reconciliation is requested.',
    { requiredReconciler: 'scheduler' },
  ),
  f(
    'schedule.expression',
    'string',
    unrestrictedStringParser,
    '',
    'Platform scheduler expression.',
    { dependencies: ['schedule.enabled=true'], requiredReconciler: 'scheduler' },
  ),
  f(
    'logging.directory',
    'path',
    pathParser,
    '.sloop/logs',
    'Directory for sensitive local run logs.',
    { sensitivity: 'sensitive' },
  ),
  f('logging.retention', 'duration', durationParser, 2_592_000_000, 'Log retention duration.'),
  f(
    'logging.roleInvocation',
    'boolean',
    booleanParser,
    true,
    'Record redacted role invocation metadata.',
  ),
  f(
    'arbiter.reviewRounds',
    'integer',
    integerParser,
    3,
    'Maximum review rounds before Arbiter intervention.',
  ),
  f(
    'arbiter.stagnatingAppearances',
    'integer',
    integerParser,
    2,
    'Repeated appearances before a finding is stagnating.',
  ),
  f('arbiter.decisions', 'integer', integerParser, 2, 'Maximum Arbiter decisions for one issue.'),
]) satisfies readonly FieldMetadata[];
/** Finds the schema metadata for one configuration path. */
export function getConfigField(path: string): FieldMetadata | undefined {
  return configRegistry.find((item) => item.path === path);
}
