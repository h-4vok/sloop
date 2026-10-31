import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SloopConfig } from '../../config.js';

/** Resolves and bounds the configured Sloop skill installation directory. */
export function getSkillDestination(root: string, config: SloopConfig): string {
  const scopeRoot = config.skills.scope === 'repository' ? root : homedir();
  const target =
    config.skills.scope === 'repository'
      ? join(root, '.codex', 'skills')
      : join(homedir(), '.codex', 'skills');
  const resolvedTarget = resolve(target);
  const relativeTarget = relative(resolve(scopeRoot), resolvedTarget);
  if (escapesSkillScope(relativeTarget))
    throw new Error('Configured skills destination escapes its allowed scope.');
  return resolvedTarget;
}

function escapesSkillScope(relativeTarget: string): boolean {
  const parentPrefix = `..${process.platform === 'win32' ? '\\' : '/'}`;
  return (
    relativeTarget === '..' || relativeTarget.startsWith(parentPrefix) || isAbsolute(relativeTarget)
  );
}

/** Resolves one distributed skill asset from the installed Sloop package. */
export function getSkillAsset(name: string): string {
  const source = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'assets',
    'skills',
    name,
    'SKILL.md',
  );
  if (!existsSync(source)) throw new Error(`Missing bundled skill asset: ${name}`);
  return source;
}
