import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfigTextResult, type SloopConfig } from '../../../../config.js';
import { result } from '../../../../core/Result.js';
import type { Result } from '../../../../core/Result.js';
import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { cleanOutput, createDiagnostic } from './checkSupport.js';

/** Holds parsed repository config and its source reference. */
export type LoadedRepositoryConfig = Readonly<{ config: SloopConfig; ref: string }>;

/** Resolves the Git repository that contains the current CLI directory. */
export function discoverRepository(io: RuntimeIo): Result<string, Diagnostic> {
  const found = io.run('git', ['rev-parse', '--show-toplevel'], io.cwd);
  if (!hasRepositoryRoot(found.status, found.stdout))
    return result.failure(
      createDiagnostic(
        'repository',
        'The current directory is not inside a Git repository.',
        'Change to the target repository or one of its subdirectories.',
      ),
    );

  const root = resolve(cleanOutput(found.stdout));
  if (!containsCurrentDirectory(root, io.cwd))
    return result.failure(
      createDiagnostic(
        'repository',
        'Git selected a repository that does not contain the current directory.',
        'Remove Git repository-routing environment overrides and change to the target repository or one of its subdirectories.',
      ),
    );

  return result.success(root);
}

function hasRepositoryRoot(status: number, stdout: string): boolean {
  return status === 0 && Boolean(cleanOutput(stdout));
}

function containsCurrentDirectory(root: string, cwd: string): boolean {
  const pathFromRoot = relative(root, resolve(cwd));
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

/** Reads and validates the repository's working-tree configuration. */
export function loadRepositoryConfig(
  root: string,
  io: RuntimeIo,
): Result<LoadedRepositoryConfig, Diagnostic> {
  const file = join(root, 'sloop.config.yaml');
  let source: string;

  try {
    source = io.readFile(file);
  } catch {
    return result.failure(
      createDiagnostic(
        'configuration',
        'sloop.config.yaml is absent from the working tree.',
        'No safe repair command is available; create a valid sloop.config.yaml in the repository root.',
      ),
    );
  }

  const configResult = loadConfigTextResult(source);
  if (!configResult.ok)
    return result.failure(
      createDiagnostic(
        'configuration',
        String(configResult.error),
        'No safe repair command is available; repair sloop.config.yaml in the working tree.',
      ),
    );

  return result.success({ config: configResult.value, ref: 'working-tree' });
}
