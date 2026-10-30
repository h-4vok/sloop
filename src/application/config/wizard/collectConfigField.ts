import {
  configValue,
  getConfigField,
  loadConfigTextResult,
  updateConfigTextResult,
  type FieldMetadata,
} from '../../../config.js';
import type { WizardSession } from './WizardSession.js';
import { askWizardField, displayWizardValue, parseWizardValueResult } from './wizardInput.js';

const CANONICAL = new Set([
  'github.labels.eligible',
  'github.labels.claimed',
  'github.labels.blocked',
  'github.labels.priority',
  'workflow.reviewOrder',
]);

/** Collects and validates one field while preserving wizard state transitions. */
async function collectConfigField(session: WizardSession, path: string): Promise<void> {
  const field = getConfigField(path)!;
  if (CANONICAL.has(path)) {
    session.logger.log(`${path}: canonical read-only (see #55)`);
    return;
  }
  if (field.dependencies.length && !(await satisfyDependencies(session, path, field))) return;
  const old = configValue(session.current as never, path);
  const answer = await askWizardField(session, field);
  session.asked.add(path);
  if (!answer.trim()) return;
  const value = await readValidWizardValue(session, field, answer);
  const updateResult = updateConfigTextResult(session.next, path, value, session.warning);
  if (!updateResult.ok) throw updateResult.error;
  session.next = updateResult.value;
  session.changed.push(`${path}: ${displayWizardValue(old)} -> ${displayWizardValue(value)}`);
}

/** Exposes one-field wizard collection as a cohesive application service. */
export const collectWizardField = Object.freeze({ run: collectConfigField });

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
  const answer = await askRequiredDependency(
    session,
    path,
    dependencyPath!,
    expected!,
    dependencyField,
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
  session.changed.push(
    `${dependencyPath}: ${displayWizardValue(old)} -> ${displayWizardValue(value)}`,
  );
  session.asked.add(dependencyPath!);
}

async function askRequiredDependency(
  session: WizardSession,
  path: string,
  dependencyPath: string,
  expected: string,
  field: FieldMetadata,
): Promise<string> {
  const context = `required by ${path}; enter ${expected}`;
  let answer = await askWizardField(session, field, context);
  while (!answer.trim() || !(await validateWizardAnswer(session, field, answer))) {
    if (!answer.trim())
      session.logger.error(`${path} requires companion path ${dependencyPath}=${expected}`);
    answer = await askWizardField(session, field, context);
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
    answer = await askWizardField(session, field);
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

function dependenciesSatisfied(config: unknown, field: FieldMetadata): boolean {
  return field.dependencies.every((dependency) => {
    const [path, expected] = dependency.split('=');
    return String(configValue(config as never, path!)) === expected;
  });
}
