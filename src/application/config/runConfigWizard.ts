import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Logger } from '../../core/Logger.js';
import {
  canonicalConfigYaml,
  configFileStore,
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  parseConfigValueResult,
  updateConfigTextResult,
  ConfigValidationError,
  type ConfigFileStore,
  type FieldMetadata,
  type Result,
} from '../../config.js';
import { migrateSkillNames } from '../../sync.js';
import type { ConfigReconcilerWithPreflight, WizardIO } from './configCommandTypes.js';

const CANONICAL = new Set([
  'github.labels.eligible',
  'github.labels.claimed',
  'github.labels.blocked',
  'github.labels.priority',
  'workflow.reviewOrder',
]);

type WizardSession = {
  root: string;
  file: string;
  init: boolean;
  sync?: string;
  reconciler: ConfigReconcilerWithPreflight;
  io: WizardIO;
  logger: Logger;
  fileStore: ConfigFileStore;
  current: unknown;
  next: string;
  changed: string[];
  asked: Set<string>;
  warning: (path: string) => void;
  useColor: boolean;
  readline: ReturnType<typeof createInterface>;
};

function fail(message: string, logger: Logger): number {
  logger.error(message);
  return 2;
}

function createUnknownConfigWarning(logger: Logger): (path: string) => void {
  return (path) => logger.error(`${path}: unknown configuration key; ignoring it`);
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Runs the interactive configuration wizard over injected IO and file boundaries. */
async function executeConfigWizard(
  root: string,
  file: string,
  scope: string | undefined,
  init: boolean,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight = async (_root, kind) => {
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
    );
  },
  io: WizardIO = { input, output },
  logger: Logger,
  fileStore: ConfigFileStore = configFileStore,
): Promise<number> {
  const sessionResult = createWizardSession(
    root,
    file,
    init,
    sync,
    reconciler,
    io,
    logger,
    fileStore,
  );
  if (!sessionResult.ok) return fail(sessionResult.error, logger);
  const session = sessionResult.value;
  try {
    await collectWizardChanges(session, scope);
    return await finishWizard(session);
  } catch (error) {
    return fail(String(error instanceof Error ? error.message : error), logger);
  } finally {
    session.readline.close();
  }
}

/** Coordinates the interactive configuration setup and edit workflow. */
export const runConfigWizard = Object.freeze({ run: executeConfigWizard });

function createWizardSession(
  root: string,
  file: string,
  init: boolean,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight,
  io: WizardIO,
  logger: Logger,
  fileStore: ConfigFileStore,
): Result<WizardSession, string> {
  const legacy = join(root, 'sloop.config.json');
  if (init && fileStore.exists(legacy))
    logger.log(`Legacy JSON detected at ${legacy}; it will remain untouched and inert.`);
  const source = fileStore.exists(file) ? fileStore.read(file) : canonicalConfigYaml();
  const initialSource = init ? migrateSkillNames(source) : source;
  const warning = createUnknownConfigWarning(logger);
  const configResult = loadConfigTextResult(initialSource, warning);
  if (!configResult.ok) return { ok: false, error: configResult.error.message };
  const changed: string[] = [];
  if (init && !fileStore.exists(file))
    changed.push('sloop.config.yaml: missing -> canonical v1 configuration');
  return {
    ok: true,
    value: {
      root,
      file,
      init,
      sync,
      reconciler,
      io,
      logger,
      fileStore,
      current: configResult.value,
      next: initialSource,
      changed,
      asked: new Set<string>(),
      warning,
      useColor: io.useColor ?? (io.output === output && !process.env.NO_COLOR),
      readline: createInterface({ input: io.input, output: io.output }),
    },
  };
}

async function collectWizardChanges(session: WizardSession, scope?: string): Promise<void> {
  for (const path of configPaths(scope)) await processWizardField(session, path);
}

async function processWizardField(session: WizardSession, path: string): Promise<void> {
  const field = getConfigField(path)!;
  if (CANONICAL.has(path)) {
    session.logger.log(`${path}: canonical read-only (see #55)`);
    return;
  }
  if (field.dependencies.length && !(await satisfyDependencies(session, path, field))) return;
  const old = configValue(session.current as never, path);
  const answer = await askField(session, field);
  session.asked.add(path);
  if (!answer.trim()) return;
  const value = await readValidWizardValue(session, field, answer);
  const updateResult = updateConfigTextResult(session.next, path, value, session.warning);
  if (!updateResult.ok) throw updateResult.error;
  session.next = updateResult.value;
  session.changed.push(`${path}: ${display(old)} -> ${display(value)}`);
}

async function satisfyDependencies(
  session: WizardSession,
  path: string,
  field: FieldMetadata,
): Promise<boolean> {
  if (dependenciesSatisfied(session.current, field)) return true;
  const previouslyAskedDependency = field.dependencies.some((dependency) =>
    session.asked.has(dependency.split('=', 1)[0]),
  );
  if (previouslyAskedDependency) {
    session.logger.log(
      `\n${path} is inactive because ${field.dependencies.join(' and ')} is not satisfied. Skipping it.`,
    );
    return false;
  }
  for (const dependency of field.dependencies) await satisfyDependency(session, path, dependency);
  if (!dependenciesSatisfied(session.current, field))
    throw new Error(`${path} requires companion path ${field.dependencies.join(', ')}`);
  return true;
}

async function satisfyDependency(
  session: WizardSession,
  path: string,
  dependency: string,
): Promise<void> {
  const [dependencyPath, expected] = dependency.split('=');
  if (String(configValue(session.current as never, dependencyPath!)) === expected) return;
  const dependencyField = getConfigField(dependencyPath!);
  if (!dependencyField)
    throw new Error(`${path} requires companion path ${dependencyPath}=${expected}`);
  const context = `required by ${path}; enter ${expected}`;
  const answer = await askRequiredDependency(
    session,
    path,
    dependencyPath!,
    expected!,
    dependencyField,
    context,
  );
  const value = await readValidWizardValue(session, dependencyField, answer);
  const old = configValue(session.current as never, dependencyPath!);
  const updateResult = updateConfigTextResult(
    session.next,
    dependencyPath!,
    value,
    session.warning,
  );
  if (!updateResult.ok) throw updateResult.error;
  session.next = updateResult.value;
  const configResult = loadConfigTextResult(session.next, session.warning);
  if (!configResult.ok) throw configResult.error;
  session.current = configResult.value;
  session.changed.push(`${dependencyPath}: ${display(old)} -> ${display(value)}`);
  session.asked.add(dependencyPath!);
}

async function askRequiredDependency(
  session: WizardSession,
  path: string,
  dependencyPath: string,
  expected: string,
  field: FieldMetadata,
  context: string,
): Promise<string> {
  let answer = await askField(session, field, context);
  while (!answer.trim() || !(await validateWizardAnswer(session, field, answer))) {
    if (!answer.trim())
      session.logger.error(`${path} requires companion path ${dependencyPath}=${expected}`);
    answer = await askField(session, field, context);
  }
  return answer;
}

async function readValidWizardValue(
  session: WizardSession,
  field: FieldMetadata,
  initialAnswer: string,
): Promise<unknown> {
  let answer = initialAnswer;
  while (true) {
    const result = parseWizardValueResult(field, answer.trim());
    if (result.ok) return result.value;
    session.logger.error(result.error.message);
    answer = await askField(session, field);
  }
}

async function validateWizardAnswer(
  session: WizardSession,
  field: FieldMetadata,
  answer: string,
): Promise<boolean> {
  const result = parseWizardValueResult(field, answer.trim());
  if (result.ok) return true;
  session.logger.error(result.error.message);
  return false;
}

async function askField(
  session: WizardSession,
  field: FieldMetadata,
  context?: string,
): Promise<string> {
  return session.readline.question(
    `\n${paint(field.path + (context ? ` (${context})` : ''), 'cyan', session.useColor)}\n  ${field.explanation}\n  ${paint('options:', 'dim', session.useColor)} ${field.choices.length ? field.choices.join(', ') : 'free value'}\n  ${paint('recommendation:', 'dim', session.useColor)} ${field.recommendation}\n  ${paint(`current value [${display(configValue(session.current as never, field.path))}]:`, 'yellow', session.useColor)} `,
  );
}

async function finishWizard(session: WizardSession): Promise<number> {
  const validationResult = loadConfigTextResult(session.next, session.warning);
  if (!validationResult.ok) return fail(validationResult.error.message, session.logger);
  preflightReconciliation(session);
  session.logger.log(
    session.changed.length
      ? `Preview\n${session.changed.join('\n')}\nConfirm changes? [y/N]`
      : 'No changes proposed.',
  );
  if (
    !session.changed.length ||
    (await session.readline.question('> ')).trim().toLowerCase() !== 'y'
  )
    return 0;
  const previousGitignore = await prepareGitignoreChange(session);
  const before = session.fileStore.exists(session.file)
    ? session.fileStore.read(session.file)
    : undefined;
  await writeWizardFiles(session, previousGitignore, before);
  await synchronizeWizard(session);
  session.logger.log('Configuration written atomically.');
  return 0;
}

function preflightReconciliation(session: WizardSession): void {
  if (session.sync !== '--sync') return;
  for (const kind of changedReconcilerKinds(session))
    session.reconciler.preflight?.(session.root, kind);
}

function changedReconcilerKinds(session: WizardSession): Set<FieldMetadata['requiredReconciler']> {
  return new Set(
    session.changed
      .map((line) => getConfigField(line.split(':', 1)[0]!)?.requiredReconciler)
      .filter((kind): kind is FieldMetadata['requiredReconciler'] => Boolean(kind)),
  );
}

async function prepareGitignoreChange(
  session: WizardSession,
): Promise<{ file: string; content: string } | undefined> {
  if (
    !session.init ||
    (await session.readline.question('Add .sloop/ to .gitignore? [Y/n] ')).trim().toLowerCase() ===
      'n'
  )
    return undefined;
  const file = join(session.root, '.gitignore');
  const text = session.fileStore.exists(file) ? session.fileStore.read(file) : '';
  return {
    file,
    content: text.split(/\r?\n/).includes('.sloop/')
      ? text
      : `${text && !text.endsWith('\n') ? '\n' : ''}.sloop/\n`,
  };
}

async function writeWizardFiles(
  session: WizardSession,
  gitignore: { file: string; content: string } | undefined,
  before: string | undefined,
): Promise<void> {
  session.fileStore.writeAtomically(session.file, session.next);
  try {
    if (gitignore) session.fileStore.writeAtomically(gitignore.file, gitignore.content);
  } catch (error) {
    if (before === undefined) session.fileStore.remove(session.file);
    else session.fileStore.writeAtomically(session.file, before);
    throw error;
  }
}

async function synchronizeWizard(session: WizardSession): Promise<void> {
  if (session.sync === '--sync') {
    for (const kind of changedReconcilerKinds(session))
      if (kind !== 'none') await session.reconciler(session.root, kind);
    session.logger.log('Synchronization completed after atomic configuration write.');
  } else if (session.init && (session.io.promptForSync ?? session.io.input === input)) {
    const answer = (
      await session.readline.question('Synchronize GitHub labels and Sloop skills now? [Y/n] ')
    )
      .trim()
      .toLowerCase();
    if (answer !== 'n') {
      await session.reconciler(session.root, 'github');
      await session.reconciler(session.root, 'skills');
    } else
      session.logger.log(
        'Prerequisites were not synchronized; run `sloop config install` to prepare them manually.',
      );
  }
}

function dependenciesSatisfied(config: unknown, field: FieldMetadata): boolean {
  return field.dependencies.every((dependency) => {
    const [path, expected] = dependency.split('=');
    return String(configValue(config as never, path!)) === expected;
  });
}

function paint(
  text: string,
  color: 'cyan' | 'yellow' | 'green' | 'red' | 'dim',
  enabled: boolean,
): string {
  if (!enabled) return text;
  const codes = { cyan: 36, yellow: 33, green: 32, red: 31, dim: 2 } as const;
  return `\u001b[${codes[color]}m${text}\u001b[0m`;
}

function parseWizardValueResult(
  field: FieldMetadata,
  raw: string,
): Result<unknown, ConfigValidationError> {
  if (field.type !== 'list' && field.type !== 'argv') return parseConfigValueResult(field, raw);
  try {
    const parsedValue =
      field.type === 'list' ? raw.split(',').map((item) => item.trim()) : JSON.parse(raw);
    return { ok: true, value: field.parser(parsedValue, `$.${field.path}`) };
  } catch (error) {
    if (error instanceof ConfigValidationError) return { ok: false, error };
    if (error instanceof SyntaxError)
      return {
        ok: false,
        error: new ConfigValidationError([
          { path: `$.${field.path}`, message: `expected valid JSON: ${error.message}` },
        ]),
      };
    throw error;
  }
}
