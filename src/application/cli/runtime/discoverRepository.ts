import type { RuntimeIo } from '../RuntimeIo.js';
import type { Diagnostic } from '../RuntimeResult.js';
import type { Result } from '../../../core/Result.js';
import { repositoryPreflight } from './RepositoryPreflight.js';

/** Resolves the Git repository containing the current CLI working directory. */
export const discoverRepository = (io: RuntimeIo): Result<string, Diagnostic> =>
  repositoryPreflight.discoverRepository(io);
