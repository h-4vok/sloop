import { join } from 'node:path';
import { stdin as input } from 'node:process';
import { getConfigField, loadConfigTextResult, type FieldMetadata } from '../../../config.js';
import type { WizardSession } from './WizardSession.js';
import { failWizard } from './wizardInput.js';

/** Validates, confirms, and persists proposed wizard changes. */
async function confirmConfigChanges(session: WizardSession): Promise<number> {
  const validationResult = loadConfigTextResult(session.next, session.warning);
  if (!validationResult.ok) return failWizard(validationResult.error.message, session.logger);
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
  const gitignore = await prepareGitignoreChange(session);
  const previousConfig = session.fileStore.exists(session.file)
    ? session.fileStore.read(session.file)
    : undefined;
  await writeWizardFiles(session, gitignore, previousConfig);
  await synchronizeWizard(session);
  session.logger.log('Configuration written atomically.');

  return 0;
}

/** Exposes the final validation and persistence stage. */
export const confirmConfigChangesStep = Object.freeze({ run: confirmConfigChanges });

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
  const content = session.fileStore.exists(file) ? session.fileStore.read(file) : '';

  return {
    file,
    content: content.split(/\r?\n/).includes('.sloop/')
      ? content
      : `${content && !content.endsWith('\n') ? '\n' : ''}.sloop/\n`,
  };
}

async function writeWizardFiles(
  session: WizardSession,
  gitignore: { file: string; content: string } | undefined,
  previousConfig: string | undefined,
): Promise<void> {
  session.fileStore.writeAtomically(session.file, session.next);
  try {
    if (gitignore) session.fileStore.writeAtomically(gitignore.file, gitignore.content);
  } catch (error) {
    if (previousConfig === undefined) session.fileStore.remove(session.file);
    else session.fileStore.writeAtomically(session.file, previousConfig);
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
    } else {
      session.logger.log(
        'Prerequisites were not synchronized; run `sloop config install` to prepare them manually.',
      );
    }
  }
}
