import {
  configValue,
  getConfigField,
  loadConfigTextResult,
  updateConfigTextResult,
  type FieldMetadata,
} from '../../../config.js';
import type { WizardSession } from './WizardSession.js';
import { askWizardField, displayWizardValue, parseWizardValueResult } from './wizardInput.js';

/** Prompts for required companion fields before allowing a dependent field. */
export async function satisfyConfigFieldDependencies(
  session: WizardSession,
  path: string,
  field: FieldMetadata,
): Promise<boolean> {
  if (dependenciesSatisfied(session.current, field)) return true;
  if (previouslyAskedDependency(session, field)) return skipInactiveField(session, path, field);
  for (const dependency of field.dependencies) await satisfyDependency(session, path, dependency);
  if (!dependenciesSatisfied(session.current, field))
    throw new Error(`${path} requires companion path ${field.dependencies.join(', ')}`);
  return true;
}

function previouslyAskedDependency(session: WizardSession, field: FieldMetadata): boolean {
  return field.dependencies.some((dependency) => session.asked.has(dependency.split('=', 1)[0]));
}

function skipInactiveField(session: WizardSession, path: string, field: FieldMetadata): false {
  session.logger.log(
    `\n${path} is inactive because ${field.dependencies.join(' and ')} is not satisfied. Skipping it.`,
  );
  return false;
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
  updateCurrentConfig(session);
  session.changed.push(
    `${dependencyPath}: ${displayWizardValue(old)} -> ${displayWizardValue(value)}`,
  );
  session.asked.add(dependencyPath!);
}

function updateCurrentConfig(session: WizardSession): void {
  const configResult = loadConfigTextResult(session.next, session.warning);
  if (!configResult.ok) throw configResult.error;
  session.current = configResult.value;
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

export async function readValidWizardValue(
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
