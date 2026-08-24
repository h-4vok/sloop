import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { Document, parseDocument, type Node } from 'yaml';

export type ConfigValueType =
  'string' | 'boolean' | 'integer' | 'duration' | 'enum' | 'list' | 'path' | 'argv';
export type Sensitivity = 'public' | 'sensitive';
export type Reconciler = 'none' | 'github' | 'workspace' | 'skills' | 'scheduler';
export type ConfigDiagnostic = { path: string; message: string };
export class ConfigValidationError extends Error {
  constructor(readonly diagnostics: readonly ConfigDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path}: ${item.message}`).join('\n'));
    this.name = 'ConfigValidationError';
  }
}

export type FieldMetadata<T = unknown> = Readonly<{
  path: string;
  type: ConfigValueType;
  parser: (value: unknown, path: string) => T;
  validation: string;
  explanation: string;
  choices: readonly unknown[];
  recommendation: string;
  dependencies: readonly string[];
  default: T;
  sensitivity: Sensitivity;
  requiredReconciler: Reconciler;
}>;

export type RunnerConfig = Readonly<{ argv: readonly string[]; timeout: number; retries: number }>;
export type SloopConfig = Readonly<{
  schemaVersion: 1;
  repository: Readonly<{ remote: string; baseBranch: string; branchPrefix: string }>;
  workspace: Readonly<{ mode: 'checkout' | 'worktree'; path: string; worktreeRoot: string }>;
  github: Readonly<{
    labels: Readonly<{
      eligible: string;
      claimed: string;
      blocked: string;
      priority: readonly string[];
    }>;
    roleMarkers: Readonly<{ worker: string; qa: string; staff: string }>;
  }>;
  workflow: Readonly<{
    humanMergeWait: boolean;
    reviewOrder: readonly ('qa' | 'staff')[];
    verification: readonly (readonly string[])[];
    requiredChecks: readonly string[];
  }>;
  agents: Readonly<{ worker: RunnerConfig; qa: RunnerConfig; staff: RunnerConfig }>;
  skills: Readonly<{ scope: 'repository' | 'user'; required: readonly string[] }>;
  health: Readonly<{ enabled: boolean; command: readonly string[]; timeout: number }>;
  loop: Readonly<{ interval: number; taskName: string }>;
  schedule: Readonly<{ enabled: boolean; expression: string }>;
  logging: Readonly<{ directory: string; retention: number; roleInvocation: boolean }>;
  arbiter: Readonly<{ reviewRounds: number; stagnatingAppearances: number; decisions: number }>;
}>;

const fail = (path: string, message: string): never => {
  throw new ConfigValidationError([{ path, message }]);
};
const stringParser = (value: unknown, path: string): string =>
  typeof value === 'string' && value.trim() ? value : fail(path, 'expected a non-empty string');
const booleanParser = (value: unknown, path: string): boolean =>
  typeof value === 'boolean' ? value : fail(path, 'expected a boolean');
const integerParser = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fail(path, 'expected a non-negative integer');
const enumParser =
  <T extends string>(choices: readonly T[]) =>
  (value: unknown, path: string): T =>
    typeof value === 'string' && choices.includes(value as T)
      ? (value as T)
      : fail(path, `expected one of: ${choices.join(', ')}`);
const listParser = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(path, 'expected a list');
  return value.map((item, index) => stringParser(item, `${path}[${index}]`));
};
const durationParser = (value: unknown, path: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return fail(path, 'expected a duration such as 5m');
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) return fail(path, 'expected a duration such as 5m');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) ? result : fail(path, 'duration is too large');
};
const executableBasename = (argument: string): string =>
  argument
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .toLowerCase()
    .replace(/\.exe$/, '');
const shellExecutables = new Set([
  'ash',
  'bash',
  'bsh',
  'cmd',
  'csh',
  'dash',
  'elvish',
  'es',
  'fish',
  'hush',
  'ion',
  'ksh',
  'mksh',
  'nu',
  'osh',
  'powershell',
  'pwsh',
  'rc',
  'sh',
  'tcsh',
  'xonsh',
  'yash',
  'zsh',
]);
const shellExecutable = (argument: string): boolean => {
  const basename = executableBasename(argument);
  if (shellExecutables.has(basename) || basename.endsWith('sh')) return true;
  return [...shellExecutables].some(
    (shell) =>
      basename.startsWith(`${shell}-`) ||
      (basename.startsWith(shell) && /^\d/.test(basename.slice(shell.length))),
  );
};
const argvParser = (value: unknown, path: string): readonly string[] => {
  const argv = listParser(value, path);
  if (argv.length === 0) fail(path, 'argv must contain an executable');
  const executable = executableBasename(argv[0]!);
  for (const [index, arg] of argv.entries()) {
    if (arg.includes('\0') || /&&|\|\||[|;<>`]|\$\(/.test(arg))
      fail(
        `${path}[${index}]`,
        'shell operators are forbidden; provide an argv array without a shell',
      );
    if (shellExecutable(arg))
      fail(`${path}[${index}]`, 'shell interpreters are forbidden; invoke the executable directly');
    if (
      executable === 'env' &&
      index > 0 &&
      (arg.startsWith('-S') || arg.startsWith('--split-string'))
    )
      fail(
        `${path}[${index}]`,
        'env split-string options are forbidden; provide each argument as a separate argv item',
      );
  }
  return argv;
};
const argvListParser = (value: unknown, path: string): readonly (readonly string[])[] => {
  if (!Array.isArray(value)) return fail(path, 'expected a list of argv arrays');
  return value.map((item, index) => argvParser(item, `${path}[${index}]`));
};
const pathParser = (value: unknown, path: string): string => {
  const result = stringParser(value, path);
  if (result.includes('\0')) fail(path, 'path contains a NUL byte');
  return result;
};

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
    recommendation: `Use ${JSON.stringify(defaultValue)} unless repository policy requires otherwise.`,
    ...extra,
  });

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
    'github.roleMarkers.staff',
    'string',
    stringParser,
    '[Staff Review]',
    'Leading marker for Staff review evidence.',
  ),
  f(
    'workflow.humanMergeWait',
    'boolean',
    booleanParser,
    true,
    'Wait for a human to merge an approved PR.',
  ),
  f(
    'workflow.reviewOrder',
    'list',
    listParser,
    ['qa', 'staff'],
    'Review roles in execution order.',
    { choices: ['qa', 'staff'] },
  ),
  f(
    'workflow.verification',
    'argv',
    argvListParser,
    [
      ['npm', 'test'],
      ['npm', 'run', 'build'],
      ['npm', 'run', 'format:check'],
    ],
    'Safe verification commands as argv arrays.',
  ),
  f('workflow.requiredChecks', 'list', listParser, ['pr-checks'], 'Required GitHub check names.', {
    requiredReconciler: 'github',
  }),
  ...(['worker', 'qa', 'staff'] as const).flatMap((role) => [
    f(
      `agents.${role}.argv`,
      'argv',
      argvParser,
      ['codex', 'exec', '--sandbox', 'danger-full-access'],
      `${role} runner argv; never evaluated by a shell.`,
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
    ['dispatcher', 'worker', 'qa-sdet', 'staff-reviewer'],
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
    (v, p) => (typeof v === 'string' ? v : fail(p, 'expected a string')),
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

export const getConfigField = (path: string): FieldMetadata | undefined =>
  configRegistry.find((item) => item.path === path);

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}
function getPath(target: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (plainObject(value) ? value[key] : undefined), target);
}
function allowedTree(): Record<string, unknown> {
  const tree: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const item of configRegistry) {
    const parts = item.path.split('.');
    let current = tree;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(current, part))
        current[part] = Object.create(null) as Record<string, unknown>;
      current = current[part] as Record<string, unknown>;
    }
    current[parts.at(-1)!] = true;
  }
  return tree;
}
function unknownKeys(value: unknown, allowed: unknown, path = '$'): ConfigDiagnostic[] {
  if (!plainObject(value) || !plainObject(allowed)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(allowed, key))
      return [
        {
          path: childPath,
          message: /secret|token|password|credential|api.?key/i.test(key)
            ? 'secrets are not accepted in sloop.config.yaml; use the external environment'
            : 'unknown configuration key',
        },
      ];
    return unknownKeys(child, allowed[key], childPath);
  });
}
function containerShapes(
  value: Record<string, unknown>,
  allowed: Record<string, unknown>,
  path = '$',
): ConfigDiagnostic[] {
  return Object.entries(allowed).flatMap(([key, child]) => {
    if (!plainObject(child) || !(key in value)) return [];
    const childPath = `${path}.${key}`;
    if (!plainObject(value[key])) return [{ path: childPath, message: 'expected a YAML mapping' }];
    return containerShapes(value[key], child, childPath);
  });
}
function credentialDiagnostics(value: unknown, path = '$'): ConfigDiagnostic[] {
  if (typeof value === 'string') {
    const hasUrlUserinfo = /^[a-z][a-z\d+.-]*:\/\/[^\s/@]+(?::[^\s/@]*)?@/i.test(value);
    const hasRecognizedToken =
      /(?:^|[^A-Za-z0-9])(?:github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{10,})(?:$|[^A-Za-z0-9])/i.test(
        value,
      );
    const hasCredentialMaterial =
      /(?:^|[=\s])(?:authorization|proxy-authorization|private-token|x-api-key|api-key|cookie|set-cookie)\s*:\s*\S+/i.test(
        value,
      ) ||
      /(?:^|[\s,;])(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[=:]\s*\S+/i.test(
        value,
      ) ||
      /[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|password|passwd)=[^&#\s]+/i.test(
        value,
      ) ||
      /^(?:--?(?:user|proxy-user|oauth2-bearer)|http\.extraheader)=\S+/i.test(value) ||
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(value);
    return hasUrlUserinfo || hasRecognizedToken || hasCredentialMaterial
      ? [
          {
            path,
            message:
              'credentials are not accepted in sloop.config.yaml; use the external environment',
          },
        ]
      : [];
  }
  if (Array.isArray(value)) {
    const credentialValueOptions =
      /^(?:-u|--user|--proxy-user|--oauth2-bearer|http\.extraheader)$/i;
    return value.flatMap((child, index) => {
      if (
        index > 0 &&
        typeof value[index - 1] === 'string' &&
        credentialValueOptions.test(value[index - 1]) &&
        typeof child === 'string' &&
        child.length > 0
      )
        return [
          {
            path: `${path}[${index}]`,
            message:
              'credentials are not accepted in sloop.config.yaml; use the external environment',
          },
        ];
      return credentialDiagnostics(child, `${path}[${index}]`);
    });
  }
  if (plainObject(value))
    return Object.entries(value).flatMap(([key, child]) =>
      credentialDiagnostics(child, `${path}.${key}`),
    );
  return [];
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

export function parseConfig(value: unknown): SloopConfig {
  if (!plainObject(value))
    throw new ConfigValidationError([{ path: '$', message: 'expected a YAML mapping' }]);
  const allowed = allowedTree();
  const diagnostics = [
    ...unknownKeys(value, allowed),
    ...containerShapes(value, allowed),
    ...credentialDiagnostics(value),
  ];
  const output: Record<string, unknown> = {};
  for (const metadata of configRegistry) {
    const raw = getPath(value, metadata.path);
    try {
      setPath(
        output,
        metadata.path,
        metadata.parser(raw === undefined ? metadata.default : raw, `$.${metadata.path}`),
      );
    } catch (error) {
      if (error instanceof ConfigValidationError) diagnostics.push(...error.diagnostics);
      else throw error;
    }
  }
  if (getPath(output, 'schemaVersion') !== 1)
    diagnostics.push({
      path: '$.schemaVersion',
      message: 'unsupported schema version; expected 1',
    });
  const order = getPath(output, 'workflow.reviewOrder');
  if (
    Array.isArray(order) &&
    (order.length !== 2 ||
      new Set(order).size !== 2 ||
      !order.includes('qa') ||
      !order.includes('staff'))
  )
    diagnostics.push({
      path: '$.workflow.reviewOrder',
      message: 'must contain qa and staff exactly once',
    });
  const markers = ['worker', 'qa', 'staff'].map((role) =>
    getPath(output, `github.roleMarkers.${role}`),
  );
  if (new Set(markers).size !== markers.length)
    diagnostics.push({ path: '$.github.roleMarkers', message: 'role markers must be unique' });
  const priorities = getPath(output, 'github.labels.priority');
  if (Array.isArray(priorities) && new Set(priorities).size !== priorities.length)
    diagnostics.push({
      path: '$.github.labels.priority',
      message: 'priority labels must be unique',
    });
  if (getPath(output, 'workspace.mode') === 'checkout' && !getPath(output, 'workspace.path'))
    diagnostics.push({
      path: '$.workspace.path',
      message: 'is required when workspace.mode is checkout',
    });
  if (
    getPath(output, 'workspace.mode') === 'worktree' &&
    !getPath(output, 'workspace.worktreeRoot')
  )
    diagnostics.push({
      path: '$.workspace.worktreeRoot',
      message: 'is required when workspace.mode is worktree',
    });
  if (getPath(output, 'schedule.enabled') === true && !getPath(output, 'schedule.expression'))
    diagnostics.push({
      path: '$.schedule.expression',
      message: 'is required when schedule.enabled is true',
    });
  for (const path of ['arbiter.reviewRounds', 'arbiter.stagnatingAppearances', 'arbiter.decisions'])
    if ((getPath(output, path) as number) < 1)
      diagnostics.push({ path: `$.${path}`, message: 'must be at least 1' });
  if (diagnostics.length) throw new ConfigValidationError(diagnostics);
  return deepFreeze(output as SloopConfig);
}

export function loadConfigText(source: string): SloopConfig {
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length)
    throw new ConfigValidationError(
      document.errors.map((error) => ({ path: '$', message: `invalid YAML: ${error.message}` })),
    );
  return parseConfig(document.toJS());
}
export function loadConfigFile(file: string): SloopConfig {
  if (extname(file).toLowerCase() === '.json')
    throw new ConfigValidationError([
      { path: '$', message: 'pre-alpha JSON configuration is unsupported; run `sloop init`' },
    ]);
  return loadConfigText(readFileSync(file, 'utf8'));
}

function fingerprintValue(config: SloopConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const metadata of configRegistry)
    setPath(
      result,
      metadata.path,
      metadata.sensitivity === 'sensitive'
        ? '<redacted>'
        : getPath(config as unknown as Record<string, unknown>, metadata.path),
    );
  return result;
}
export function configFingerprint(config: SloopConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(fingerprintValue(config)))
    .digest('hex');
}

export function updateConfigText(source: string, path: string, value: unknown): string {
  const metadata = getConfigField(path);
  if (!metadata)
    throw new ConfigValidationError([{ path: `$.${path}`, message: 'unknown configuration key' }]);
  metadata.parser(value, `$.${path}`);
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length)
    throw new ConfigValidationError(
      document.errors.map((error) => ({ path: '$', message: `invalid YAML: ${error.message}` })),
    );
  document.setIn(path.split('.'), value as Node);
  parseConfig(document.toJS());
  return document.toString({ lineWidth: 0 });
}
export function updateConfigFile(file: string, path: string, value: unknown): void {
  const next = updateConfigText(readFileSync(file, 'utf8'), path, value);
  const temporary = join(dirname(file), `.${randomUUID()}.sloop.tmp`);
  try {
    writeFileSync(temporary, next, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function canonicalConfigYaml(): string {
  const document = new Document();
  const value: Record<string, unknown> = {};
  for (const metadata of configRegistry)
    setPath(
      value,
      metadata.path,
      metadata.type === 'duration' ? formatDuration(metadata.default as number) : metadata.default,
    );
  document.contents = document.createNode(value);
  for (const metadata of configRegistry) {
    const node = document.getIn(metadata.path.split('.'), true);
    if (node && typeof node === 'object') (node as Node).commentBefore = ` ${metadata.explanation}`;
  }
  return document.toString({ lineWidth: 0 });
}
function formatDuration(milliseconds: number): string {
  for (const [unit, amount] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ] as const)
    if (milliseconds % amount === 0) return `${milliseconds / amount}${unit}`;
  return `${milliseconds}ms`;
}
