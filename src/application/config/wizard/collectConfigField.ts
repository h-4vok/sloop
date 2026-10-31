import {
  configValue,
  getConfigField,
  updateConfigTextResult,
  type FieldMetadata,
} from '../../../config.js';
import type { WizardSession } from './WizardSession.js';
import { askWizardField, displayWizardValue } from './wizardInput.js';
import {
  readValidWizardValue,
  satisfyConfigFieldDependencies,
} from './collectConfigFieldDependencies.js';

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
  if (!(await prepareFieldCollection(session, path, field))) return;
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

async function prepareFieldCollection(
  session: WizardSession,
  path: string,
  field: FieldMetadata,
): Promise<boolean> {
  if (CANONICAL.has(path)) {
    session.logger.log(`${path}: canonical read-only (see #55)`);
    return false;
  }
  if (field.dependencies.length) return satisfyConfigFieldDependencies(session, path, field);
  return true;
}

/** Exposes one-field wizard collection as a cohesive application service. */
export const collectWizardField = Object.freeze({ run: collectConfigField });
